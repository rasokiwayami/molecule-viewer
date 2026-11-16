import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

/**
 * Loads the hand-tracking model. urls is { wasm, model }; moduleBuild picks the WASM loader
 * that can be imported inside a module worker.
 */
export async function createLandmarker(urls, { moduleBuild = false, canvas } = {}) {
  const files = await FilesetResolver.forVisionTasks(urls.wasm, moduleBuild);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: urls.model, delegate },
    ...(canvas ? { canvas } : {}),
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.55,
  });
  try {
    return await HandLandmarker.createFromOptions(files, options('GPU'));
  } catch {
    return HandLandmarker.createFromOptions(files, options('CPU'));
  }
}

/** The part of a detection result that the app uses, in a form that can cross threads. */
export function summarise(result) {
  return {
    landmarks: result.landmarks,
    labels: result.landmarks.map((_, i) => result.handedness?.[i]?.[0]?.categoryName || String(i)),
  };
}
