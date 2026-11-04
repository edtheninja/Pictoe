import { describe, expect, it, vi } from "vitest";
import {
  RenderClient,
  type PreviewRequest,
  type RenderCallbacks,
  type WorkerLike,
} from "./renderClient";
import type { FromWorker, ToWorker } from "./renderProtocol";
import { DEFAULT_EDIT_STATE } from "@/types/editor";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const bitmap = () => ({ width: 100, height: 50, close: vi.fn() }) as unknown as ImageBitmap;

class FakeWorker implements WorkerLike {
  posted: { message: ToWorker; transfer: Transferable[] | undefined }[] = [];
  terminated = false;
  onmessage: WorkerLike["onmessage"] = null;
  onerror: WorkerLike["onerror"] = null;
  onmessageerror: WorkerLike["onmessageerror"] = null;
  postMessage(message: ToWorker, transfer?: Transferable[]) {
    this.posted.push({ message, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  reply(message: FromWorker) {
    this.onmessage?.({ data: message });
  }
  renders() {
    return this.posted.map((p) => p.message).filter((m) => m.type === "render");
  }
}

function setup(opts: { createBitmap?: () => Promise<ImageBitmap> } = {}) {
  const worker = new FakeWorker();
  const created: ImageBitmap[] = [];
  const createBitmap = vi.fn(
    opts.createBitmap ??
      (async () => {
        const b = bitmap();
        created.push(b);
        return b;
      }),
  );
  const client = new RenderClient({ createWorker: () => worker, createBitmap });
  return { client, worker, createBitmap, created };
}

const request = (n = 0): PreviewRequest => ({
  edit: { ...DEFAULT_EDIT_STATE, adjustments: { ...DEFAULT_EDIT_STATE.adjustments, exposure: n } },
  maxDimension: 800,
  maskLayers: undefined,
});
const callbacks = () =>
  ({ done: vi.fn(), error: vi.fn(), unavailable: vi.fn() }) satisfies RenderCallbacks;
const frame = (requestId: number): FromWorker => ({
  type: "rendered",
  requestId,
  bitmap: bitmap(),
  width: 100,
  height: 50,
});
const img = () => ({}) as ImageBitmapSource;
const exposureOf = (m: ToWorker) => (m.type === "render" ? m.edit.adjustments.exposure : undefined);

describe("RenderClient", () => {
  it("waits for the source bitmap, sends it transferred, then renders", async () => {
    const { client, worker, created } = setup();
    const cb = callbacks();
    client.useSource(img(), 4000, 3000);
    client.render(request(1), cb);
    expect(worker.posted).toHaveLength(0); // nothing until the bitmap exists
    await flush();
    expect(worker.posted[0]!.message).toMatchObject({
      type: "setSource",
      sourceId: 1,
      width: 4000,
      height: 3000,
    });
    expect(worker.posted[0]!.transfer).toEqual([created[0]]);
    expect(worker.renders()).toHaveLength(1);
    expect(worker.posted[1]!.message).toMatchObject({ type: "render", sourceId: 1 });
  });

  it("builds the bitmap once per image", async () => {
    const { client, createBitmap } = setup();
    const el = img();
    client.useSource(el, 10, 10);
    client.useSource(el, 10, 10);
    await flush();
    expect(createBitmap).toHaveBeenCalledTimes(1);
  });

  it("keeps only the newest waiting request while one is rendering (latest wins)", async () => {
    const { client, worker } = setup();
    const [a, b, c] = [callbacks(), callbacks(), callbacks()];
    client.useSource(img(), 10, 10);
    await flush();
    client.render(request(1), a);
    client.render(request(2), b);
    client.render(request(3), c);
    expect(worker.renders().map(exposureOf)).toEqual([1]); // only the first has been sent

    worker.reply(frame(1));
    // The finished frame is still drawn, even though newer work is waiting.
    expect(a.done).toHaveBeenCalledTimes(1);
    // Then the newest request runs; the one in between was dropped without being sent.
    expect(worker.renders().map(exposureOf)).toEqual([1, 3]);
    worker.reply(frame(2));
    expect(c.done).toHaveBeenCalledTimes(1);
    expect(b.done).not.toHaveBeenCalled();
    expect(b.unavailable).not.toHaveBeenCalled();
  });

  it("runs one render at a time", async () => {
    const { client, worker } = setup();
    client.useSource(img(), 10, 10);
    await flush();
    client.render(request(1), callbacks());
    client.render(request(2), callbacks());
    expect(worker.renders()).toHaveLength(1);
  });

  it("discards a frame that finished after the image was swapped", async () => {
    const { client, worker } = setup();
    const cb = callbacks();
    client.useSource(img(), 10, 10);
    await flush();
    client.render(request(1), cb);
    client.useSource(img(), 20, 20); // new image while the old render is running
    const stale = frame(1);
    worker.reply(stale);
    expect(cb.done).not.toHaveBeenCalled();
    expect((stale as { bitmap: ImageBitmap }).bitmap.close).toHaveBeenCalled();
  });

  it("closes frames it was not waiting for", async () => {
    const { client, worker } = setup();
    client.useSource(img(), 10, 10);
    await flush();
    const unexpected = frame(99);
    worker.reply(unexpected);
    expect((unexpected as { bitmap: ImageBitmap }).bitmap.close).toHaveBeenCalled();
  });

  it("passes a render error to the caller and carries on with the next request", async () => {
    const { client, worker } = setup();
    const [a, b] = [callbacks(), callbacks()];
    client.useSource(img(), 10, 10);
    await flush();
    client.render(request(1), a);
    client.render(request(2), b);
    worker.reply({ type: "error", requestId: 1, message: "boom" });
    expect(a.error).toHaveBeenCalledWith("boom");
    expect(client.usable()).toBe(true);
    expect(worker.renders().map(exposureOf)).toEqual([1, 2]);
  });

  it("falls back for everything waiting when the Worker errors, and stays unusable", async () => {
    const { client, worker } = setup();
    const [a, b] = [callbacks(), callbacks()];
    client.useSource(img(), 10, 10);
    await flush();
    client.render(request(1), a);
    client.render(request(2), b);
    worker.onerror?.(new Error("worker died"));
    expect(a.unavailable).toHaveBeenCalledTimes(1);
    expect(b.unavailable).toHaveBeenCalledTimes(1);
    expect(worker.terminated).toBe(true);
    expect(client.usable()).toBe(false);

    const later = callbacks();
    client.render(request(3), later);
    expect(later.unavailable).toHaveBeenCalledTimes(1);
  });

  it("falls back when the image can't be turned into a bitmap", async () => {
    const { client } = setup({ createBitmap: () => Promise.reject(new Error("too big")) });
    const cb = callbacks();
    client.useSource(img(), 10, 10);
    client.render(request(1), cb);
    await flush();
    expect(cb.unavailable).toHaveBeenCalledTimes(1);
    expect(client.usable()).toBe(false);
  });

  it("is unusable, and reports so, when the Worker can't even be created", () => {
    const client = new RenderClient({
      createWorker: () => {
        throw new Error("no workers here");
      },
      createBitmap: async () => bitmap(),
    });
    const cb = callbacks();
    expect(client.usable()).toBe(false);
    client.render(request(1), cb);
    expect(cb.unavailable).toHaveBeenCalledTimes(1);
  });

  it("frees the Worker's image on clearSource and accepts the same image again later", async () => {
    const { client, worker, createBitmap } = setup();
    const el = img();
    client.useSource(el, 10, 10);
    await flush();
    client.clearSource();
    expect(worker.posted.at(-1)!.message).toEqual({ type: "clearSource" });
    client.useSource(el, 10, 10);
    await flush();
    expect(createBitmap).toHaveBeenCalledTimes(2);
    expect(worker.posted.at(-1)!.message).toMatchObject({ type: "setSource", sourceId: 3 });
  });

  it("closes a bitmap that finished decoding after the image had already changed", async () => {
    let resolveFirst!: (b: ImageBitmap) => void;
    const late = bitmap();
    let calls = 0;
    const { client, worker } = setup({
      createBitmap: () =>
        ++calls === 1
          ? new Promise<ImageBitmap>((r) => (resolveFirst = r))
          : Promise.resolve(bitmap()),
    });
    client.useSource(img(), 10, 10);
    client.useSource(img(), 20, 20);
    resolveFirst(late);
    await flush();
    expect(late.close).toHaveBeenCalled();
    const sources = worker.posted.map((p) => p.message).filter((m) => m.type === "setSource");
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ width: 20, height: 20 });
  });
});
