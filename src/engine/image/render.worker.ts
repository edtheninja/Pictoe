/// <reference lib="webworker" />
/**
 * Preview render Worker. Thin wiring only; the logic lives in renderHandler.ts so it can be tested
 * without a browser. The main thread drives it through renderClient.ts.
 */
import { renderImage } from "./render";
import { createRenderHandler } from "./renderHandler";
import type { ToWorker } from "./renderProtocol";

const scope = self as unknown as Worker;

const handle = createRenderHandler({
  post: (message, transfer) => scope.postMessage(message, transfer),
  createTarget: () => new OffscreenCanvas(1, 1),
  render: (source, width, height, edit, target, maxDimension, maskLayers) =>
    renderImage(source, width, height, edit, target, maxDimension, maskLayers),
});

scope.onmessage = (event: MessageEvent<ToWorker>) => handle(event.data);
