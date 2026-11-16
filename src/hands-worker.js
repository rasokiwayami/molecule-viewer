// Runs hand tracking off the main thread, so that rendering is never paused by it.
import { createLandmarker, summarise } from './landmarker.js';

let landmarker = null;

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      landmarker = await createLandmarker(data.urls, {
        moduleBuild: true,
        canvas: new OffscreenCanvas(1, 1),
      });
      self.postMessage({ type: 'ready' });
    } catch {
      self.postMessage({ type: 'error' });
    }
    return;
  }
  try {
    self.postMessage({
      type: 'result',
      result: summarise(landmarker.detectForVideo(data.bitmap, data.time)),
    });
  } catch {
    self.postMessage({ type: 'error' });
  } finally {
    data.bitmap.close();
  }
};
