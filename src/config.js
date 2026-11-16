export const CONFIG = {
  workshop: '',
  searchTimeout: 5000,
  hands: { pinchStart: 0.25, pinchEnd: 0.35, fps: 20, minCutoff: 1.2, beta: 0.06 },
};
export const assetURL = (path) => `${import.meta.env.BASE_URL}${path}`;
