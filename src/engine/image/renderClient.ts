import type { EditState, MaskLayer } from "@/types/editor";
import type { FromWorker, ToWorker } from "./renderProtocol";
import { recordTime } from "./profile";

/**
 * Main-thread side of the preview render Worker.
 *
 * Only one render runs at a time, and while it runs only the newest request is kept ("latest
 * wins"), so dragging a slider never builds a queue of stale frames. A finished frame is always
 * drawn, even if a newer request is already waiting, so the preview keeps moving during a drag.
 *
 * If anything about the Worker fails (it can't start, the image can't be turned into a bitmap, it
 * throws an unexpected error) the client marks itself unusable and tells the caller, which then
 * renders on the main thread exactly as before.
 */

export type PreviewRequest = {
  edit: EditState;
  maxDimension: number;
  maskLayers: MaskLayer[] | undefined;
};

export type PreviewFrame = { bitmap: ImageBitmap; width: number; height: number };

export type RenderCallbacks = {
  done: (frame: PreviewFrame) => void;
  error: (message: string) => void;
  /** The Worker can't do this render; render it on the main thread instead. */
  unavailable: () => void;
};

export type WorkerLike = {
  postMessage(message: ToWorker, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: FromWorker }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
};

export type ClientDeps = {
  createWorker: () => WorkerLike;
  createBitmap: (source: ImageBitmapSource) => Promise<ImageBitmap>;
  now?: () => number;
};

type Pending = { request: PreviewRequest; callbacks: RenderCallbacks };
type InFlight = Pending & { requestId: number; sourceId: number; startedAt: number };

export class RenderClient {
  private worker: WorkerLike | null;
  private broken = false;
  private element: ImageBitmapSource | null = null;
  private sourceId = 0;
  private sourceReady = false;
  private latest: Pending | null = null;
  private inFlight: InFlight | null = null;
  private nextRequestId = 1;
  private readonly now: () => number;

  constructor(private readonly deps: ClientDeps) {
    this.now = deps.now ?? (() => performance.now());
    try {
      const worker = deps.createWorker();
      worker.onmessage = (event) => this.handleMessage(event.data);
      worker.onerror = () => this.fail();
      worker.onmessageerror = () => this.fail();
      this.worker = worker;
    } catch {
      this.worker = null;
      this.broken = true;
    }
  }

  usable(): boolean {
    return !this.broken && this.worker !== null;
  }

  /** Makes `element` the image the Worker renders from. No-op if it already is. */
  useSource(element: ImageBitmapSource, width: number, height: number): void {
    if (!this.usable() || this.element === element) return;
    this.element = element;
    const id = ++this.sourceId;
    this.sourceReady = false;
    this.deps.createBitmap(element).then(
      (bitmap) => {
        if (!this.usable() || id !== this.sourceId) {
          bitmap.close();
          return;
        }
        this.worker!.postMessage({ type: "setSource", sourceId: id, bitmap, width, height }, [
          bitmap,
        ]);
        this.sourceReady = true;
        this.pump();
      },
      () => this.fail(),
    );
  }

  /** Frees the Worker's copy of the image (the editor was cleared). */
  clearSource(): void {
    if (this.element === null) return;
    this.element = null;
    this.sourceId++;
    this.sourceReady = false;
    this.latest = null;
    if (this.usable()) this.worker!.postMessage({ type: "clearSource" });
  }

  /** Requests a preview. Replaces any request that is still waiting to start. */
  render(request: PreviewRequest, callbacks: RenderCallbacks): void {
    if (!this.usable()) {
      callbacks.unavailable();
      return;
    }
    this.latest = { request, callbacks };
    this.pump();
  }

  private pump(): void {
    if (this.inFlight || !this.sourceReady || !this.latest || !this.usable()) return;
    const pending = this.latest;
    this.latest = null;
    const requestId = this.nextRequestId++;
    this.inFlight = {
      ...pending,
      requestId,
      sourceId: this.sourceId,
      startedAt: this.now(),
    };
    this.worker!.postMessage({
      type: "render",
      requestId,
      sourceId: this.sourceId,
      edit: pending.request.edit,
      maxDimension: pending.request.maxDimension,
      maskLayers: pending.request.maskLayers,
    });
  }

  private handleMessage(message: FromWorker): void {
    const flight = this.inFlight;
    if (!flight || message.requestId !== flight.requestId) {
      if (message.type === "rendered") message.bitmap.close();
      return;
    }
    this.inFlight = null;

    if (message.type === "error") {
      flight.callbacks.error(message.message);
    } else if (flight.sourceId !== this.sourceId) {
      // The image was swapped while this frame was rendering; it belongs to the old one.
      message.bitmap.close();
    } else {
      recordTime("worker round trip", this.now() - flight.startedAt);
      flight.callbacks.done({
        bitmap: message.bitmap,
        width: message.width,
        height: message.height,
      });
    }
    this.pump();
  }

  private fail(): void {
    if (this.broken) return;
    this.broken = true;
    const waiting = [this.inFlight, this.latest];
    this.inFlight = null;
    this.latest = null;
    try {
      this.worker?.terminate();
    } catch {
      // Nothing useful to do if terminate itself fails.
    }
    this.worker = null;
    for (const pending of waiting) pending?.callbacks.unavailable();
  }
}

function workerDisabled(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has("noworker")) return true;
    return window.localStorage?.getItem("pictoeWorker") === "0";
  } catch {
    return false;
  }
}

function workerSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof OffscreenCanvas.prototype.transferToImageBitmap === "function" &&
    typeof createImageBitmap === "function" &&
    !workerDisabled()
  );
}

let shared: RenderClient | null | undefined;

/**
 * The app's preview client, created on first use, or null where the browser can't do it (or when
 * the page was opened with `?noworker`, or `localStorage.pictoeWorker = "0"`, to compare against
 * main-thread rendering).
 */
export function getRenderClient(): RenderClient | null {
  if (shared !== undefined) return shared;
  if (!workerSupported()) {
    shared = null;
    return shared;
  }
  shared = new RenderClient({
    createWorker: () =>
      new Worker(new URL("./render.worker.ts", import.meta.url), {
        type: "module",
      }) as unknown as WorkerLike,
    createBitmap: (source) => createImageBitmap(source),
  });
  return shared;
}
