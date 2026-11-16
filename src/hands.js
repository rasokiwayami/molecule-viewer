import { CONFIG, assetURL } from './config.js';

const ACCENT = '#d7ff5e';
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const ROTATION_GAIN = 5;
// A hand that jumps this far between frames is treated as a new hand.
const JUMP_LIMIT = 0.22;
const SKELETON = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

/** Smooths a jittery signal while keeping fast movements responsive. */
export class OneEuroFilter {
  constructor(minCutoff = CONFIG.hands.minCutoff, beta = CONFIG.hands.beta) {
    this.minCutoff = minCutoff;
    this.beta = beta;
  }

  filter(value, time) {
    if (this.time === undefined) {
      Object.assign(this, { time, value, raw: value, derivative: 0 });
      return value;
    }
    const dt = Math.max(0.001, (time - this.time) / 1000);
    const alpha = (cutoff) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    this.derivative += alpha(1) * ((value - this.raw) / dt - this.derivative);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    this.value += alpha(cutoff) * (value - this.value);
    this.time = time;
    this.raw = value;
    return this.value;
  }
}

/** Separate thresholds for starting and ending a pinch keep it from flickering. */
export function pinchState(ratio, active) {
  return active ? ratio <= CONFIG.hands.pinchEnd : ratio < CONFIG.hands.pinchStart;
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Camera hand tracking. One pinching hand rotates the molecule, two pinching hands zoom it.
 * onChange('off' | 'starting' | 'on'), onHands([{x, y, pinched}]) in mirrored 0..1 coordinates,
 * onError(reason) with 'denied' | 'no-camera' | 'failed'.
 */
export function createHands({ video, overlay, scene, onChange, onHands, onError }) {
  const context = overlay.getContext('2d');
  let landmarker = null;
  let stream = null;
  let state = 'off';
  let session = 0;
  let frameRequest = 0;
  let lastVideoTime = -1;
  let lastInference = 0;
  let tracked = new Map();
  let lastPinches = null;

  function setState(next) {
    state = next;
    onChange(next);
  }

  function stop() {
    session++;
    cancelAnimationFrame(frameRequest);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    landmarker?.close();
    landmarker = null;
    tracked.clear();
    lastPinches = null;
    lastVideoTime = -1;
    onHands([]);
    setState('off');
  }

  function fail(error) {
    stop();
    const reason = { NotAllowedError: 'denied', NotFoundError: 'no-camera' }[error?.name];
    onError(reason || 'failed');
  }

  async function createLandmarker() {
    const { HandLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks(assetURL('mediapipe'));
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: assetURL('mediapipe/hand_landmarker.task'), delegate },
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

  async function start() {
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      onError('no-camera');
      return;
    }
    const mySession = ++session;
    setState('starting');
    let pendingStream;
    let pendingLandmarker;
    try {
      // Ask for the camera first, so a refusal does not cost a 37 MB download.
      pendingStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      if (mySession !== session) throw new Error('cancelled');
      stream = pendingStream;
      video.srcObject = stream;
      await video.play();
      pendingLandmarker = await createLandmarker();
      if (mySession !== session) throw new Error('cancelled');
      landmarker = pendingLandmarker;
      navigator.serviceWorker?.controller?.postMessage({ type: 'CACHE_HANDS' });
      stream.getVideoTracks()[0]?.addEventListener('ended', () => state === 'on' && fail(), {
        once: true,
      });
      setState('on');
      frameRequest = requestAnimationFrame(loop);
    } catch (error) {
      if (mySession === session) {
        fail(error);
      } else {
        pendingStream?.getTracks().forEach((track) => track.stop());
        pendingLandmarker?.close();
      }
    }
  }

  function loop(now) {
    if (state !== 'on') return;
    const hasNewFrame = video.readyState >= 2 && video.currentTime !== lastVideoTime;
    if (!document.hidden && hasNewFrame && now - lastInference >= 1000 / CONFIG.hands.fps) {
      lastVideoTime = video.currentTime;
      lastInference = now;
      try {
        handle(landmarker.detectForVideo(video, now), now);
      } catch (error) {
        fail(error);
        return;
      }
    }
    frameRequest = requestAnimationFrame(loop);
  }

  function drawSkeleton(points, pinched) {
    const { width, height } = overlay;
    context.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    context.lineWidth = 2;
    for (const [a, b] of SKELETON) {
      context.beginPath();
      context.moveTo(points[a].x * width, points[a].y * height);
      context.lineTo(points[b].x * width, points[b].y * height);
      context.stroke();
    }
    for (const tip of [THUMB_TIP, INDEX_TIP]) {
      context.fillStyle = pinched ? ACCENT : '#ffffff';
      context.beginPath();
      context.arc(points[tip].x * width, points[tip].y * height, pinched ? 9 : 6, 0, Math.PI * 2);
      context.fill();
    }
  }

  function handle(result, now) {
    overlay.width = video.videoWidth || 640;
    overlay.height = video.videoHeight || 480;
    context.clearRect(0, 0, overlay.width, overlay.height);

    const hands = [];
    const seen = new Set();
    result.landmarks.forEach((points, i) => {
      const label = result.handedness?.[i]?.[0]?.categoryName || String(i);
      if (seen.has(label)) return;
      seen.add(label);

      const pinchPoint = {
        x: (points[THUMB_TIP].x + points[INDEX_TIP].x) / 2,
        y: (points[THUMB_TIP].y + points[INDEX_TIP].y) / 2,
      };
      let hand = tracked.get(label);
      const jumped =
        hand && Math.hypot(pinchPoint.x - hand.raw.x, pinchPoint.y - hand.raw.y) > JUMP_LIMIT;
      if (!hand || jumped) {
        hand = { pinched: false, x: new OneEuroFilter(), y: new OneEuroFilter() };
        lastPinches = null;
      }
      const handSize = Math.max(
        distance(points[0], points[9]),
        distance(points[5], points[17]),
        0.001,
      );
      hand.pinched = pinchState(
        distance(points[THUMB_TIP], points[INDEX_TIP]) / handSize,
        hand.pinched,
      );
      hand.raw = pinchPoint;
      tracked.set(label, hand);

      // The video is shown mirrored, so x is flipped for anything drawn on screen.
      hands.push({
        id: label,
        x: 1 - hand.x.filter(pinchPoint.x, now),
        y: hand.y.filter(pinchPoint.y, now),
        pinched: hand.pinched,
      });
      drawSkeleton(points, hand.pinched);
    });
    for (const label of tracked.keys()) {
      if (!seen.has(label)) {
        tracked.delete(label);
        lastPinches = null;
      }
    }
    onHands(hands);
    applyGesture(hands.filter((hand) => hand.pinched).sort((a, b) => a.id.localeCompare(b.id)));
  }

  /** Moves the molecule by the change since the previous frame with the same pinching hands. */
  function applyGesture(pinches) {
    const signature = pinches.map((hand) => hand.id).join(',');
    const before = lastPinches?.signature === signature ? lastPinches.pinches : null;
    lastPinches = pinches.length ? { signature, pinches } : null;
    if (!before) return;

    if (pinches.length === 1) {
      scene.rotate(
        (pinches[0].x - before[0].x) * ROTATION_GAIN,
        (pinches[0].y - before[0].y) * ROTATION_GAIN,
      );
      return;
    }
    const spread = Math.hypot(pinches[0].x - pinches[1].x, pinches[0].y - pinches[1].y);
    const spreadBefore = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
    if (spread > 0.05 && spreadBefore > 0.05) {
      scene.scaleBy(Math.min(1.18, Math.max(0.85, spread / spreadBefore)));
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      tracked.clear();
      lastPinches = null;
    }
  });
  window.addEventListener('pagehide', stop);

  return {
    toggle: () => (state === 'off' ? start() : stop()),
    stop,
  };
}
