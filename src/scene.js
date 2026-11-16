import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { element } from './elements.js';

const BACKGROUND = 0x04060c;
const ACCENT = 0xd7ff5e;
const BOND_RADIUS = 0.07;
const MULTI_BOND_GAP = 0.19;
const ASSEMBLE_MS = 1500;
const SCATTER_MS = 380;
const IDLE_BEFORE_SPIN_MS = 3000;
const BLOOM_REST = 0.2;
const BLOOM_FLASH = 0.95;

// Rendering quality from full to lightest. The scene moves one step down when frames run slow.
const QUALITY_STEPS = [
  { pixelRatio: 2, bloom: true },
  { pixelRatio: 1.5, bloom: true },
  { pixelRatio: 1, bloom: true },
  { pixelRatio: 1, bloom: false },
  { pixelRatio: 0.75, bloom: false },
];
const SLOW_FRAME_MS = 24;
const FRAMES_PER_CHECK = 45;
// Molecules with more atoms than this use spheres with fewer triangles.
const DETAILED_ATOM_LIMIT = 70;

const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
const clamp01 = (t) => Math.min(1, Math.max(0, t));

/** Soft round texture used for the glow behind the molecule and for dust. */
function radialTexture(stops) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createDust(texture) {
  const count = 700;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const direction = new THREE.Vector3().randomDirection();
    direction.multiplyScalar(9 + Math.random() * 26);
    direction.toArray(positions, i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    map: texture,
    size: 0.16,
    color: 0x9fb4ff,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}

/** In-plane offset direction for double and triple bonds, so rings look flat. */
function bondSideVector(bond, positions, neighbours) {
  const direction = positions[bond.b].clone().sub(positions[bond.a]).normalize();
  const other =
    neighbours[bond.a].find((i) => i !== bond.b) ?? neighbours[bond.b].find((i) => i !== bond.a);
  const reference =
    other === undefined
      ? new THREE.Vector3(0, 0, 1)
      : positions[other].clone().sub(positions[bond.a]);
  const normal = new THREE.Vector3().crossVectors(direction, reference);
  if (normal.lengthSq() < 1e-6) normal.set(direction.y, -direction.x, 0.3);
  return new THREE.Vector3().crossVectors(normal, direction).normalize();
}

/** The colour of the most common atom that is not carbon or hydrogen. */
function tintOf(atoms) {
  const counts = {};
  for (const atom of atoms) {
    if (atom.el !== 'C' && atom.el !== 'H') counts[atom.el] = (counts[atom.el] || 0) + 1;
  }
  const [dominant] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ['N'];
  return new THREE.Color(element(dominant).color);
}

export function createScene({ host, atomLabel, onFailure }) {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', '分子の立体模型');
  host.append(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  camera.position.z = 20;

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.9);
  keyLight.position.set(-5, 7, 9);
  const rimLight = new THREE.DirectionalLight(0x7aa8ff, 1.8);
  rimLight.position.set(6, -3, -6);
  scene.add(keyLight, rimLight);

  const softTexture = radialTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.35, 'rgba(255,255,255,0.35)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  const dust = createDust(softTexture);
  scene.add(dust);

  // pivot: where the molecule sits on screen. root: what the user rotates and zooms.
  const pivot = new THREE.Group();
  const root = new THREE.Group();
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: softTexture,
      transparent: true,
      opacity: 0.13,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  glow.renderOrder = -1;
  pivot.add(glow, root);
  scene.add(pivot);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM_REST, 0.5, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const sphereGeometry = new THREE.SphereGeometry(1, 24, 16);
  const detailedSphereGeometry = coarse ? sphereGeometry : new THREE.SphereGeometry(1, 40, 28);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
  const outline = new THREE.Mesh(
    sphereGeometry,
    new THREE.MeshBasicMaterial({ color: ACCENT, side: THREE.BackSide }),
  );
  outline.visible = false;
  root.add(outline);

  const dummy = new THREE.Object3D();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3(1, 0, 0);
  const spin = new THREE.Quaternion();

  let current = null;
  let leaving = [];
  let selected = -1;
  let fitScale = 1;
  let zoom = 1;
  let velocity = { x: 0, y: 0 };
  let lastInput = 0;
  let lastFrame = performance.now();
  let flashStart = -Infinity;
  let frameRequest = 0;
  let quality = coarse ? 1 : 0;
  let slowness = { total: 0, frames: 0 };

  function buildModel(data) {
    const centre = new THREE.Vector3();
    data.atoms.forEach((a) => centre.add(new THREE.Vector3(a.x, a.y, a.z)));
    centre.divideScalar(data.atoms.length);
    const positions = data.atoms.map((a) => new THREE.Vector3(a.x, a.y, a.z).sub(centre));
    const radii = data.atoms.map((a) => element(a.el).radius);
    const radius = Math.max(2.4, ...positions.map((p, i) => p.length() + radii[i]));

    // Atoms closest to the centre arrive first, so the molecule grows outwards.
    const order = positions.map((p, i) => [p.length(), i]).sort((a, b) => a[0] - b[0]);
    const delays = new Array(positions.length);
    order.forEach(([, index], rank) => {
      delays[index] = (rank / Math.max(1, positions.length - 1)) * 0.45;
    });
    const origins = positions.map((p) =>
      p
        .clone()
        .add(new THREE.Vector3().randomDirection().multiplyScalar(radius * 2.4 + 5))
        .applyAxisAngle(yAxis, 1.4),
    );

    const atomMesh = new THREE.InstancedMesh(
      data.atoms.length > DETAILED_ATOM_LIMIT ? sphereGeometry : detailedSphereGeometry,
      new THREE.MeshPhysicalMaterial({
        roughness: 0.28,
        metalness: 0,
        clearcoat: 0.7,
        clearcoatRoughness: 0.12,
        envMapIntensity: 0.32,
      }),
      data.atoms.length,
    );
    data.atoms.forEach((a, i) => atomMesh.setColorAt(i, new THREE.Color(element(a.el).color)));

    const neighbours = data.atoms.map(() => []);
    data.bonds.forEach((b) => {
      neighbours[b.a].push(b.b);
      neighbours[b.b].push(b.a);
    });
    // Each bond is drawn as two halves, each tinted with the colour of its own atom.
    const halves = [];
    for (const bond of data.bonds) {
      const strands = bond.order >= 2 && bond.order <= 3 ? bond.order : 1;
      const side = bondSideVector(bond, positions, neighbours);
      const middle = positions[bond.a].clone().lerp(positions[bond.b], 0.5);
      for (let strand = 0; strand < strands; strand++) {
        const offset = side.clone().multiplyScalar((strand - (strands - 1) / 2) * MULTI_BOND_GAP);
        for (const atom of [bond.a, bond.b]) {
          halves.push({
            from: positions[atom].clone().add(offset),
            to: middle.clone().add(offset),
            atom,
            ready: Math.max(delays[bond.a], delays[bond.b]) + 0.3,
            thin: strands > 1,
          });
        }
      }
    }
    const bondMesh = new THREE.InstancedMesh(
      cylinderGeometry,
      new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 }),
      halves.length,
    );
    halves.forEach((half, i) => {
      const colour = new THREE.Color(element(data.atoms[half.atom].el).color);
      bondMesh.setColorAt(i, colour.lerp(new THREE.Color(0x9aa9bd), 0.45));
    });

    for (const mesh of [atomMesh, bondMesh]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
    }
    const group = new THREE.Group();
    group.add(atomMesh, bondMesh);
    return { data, group, atomMesh, bondMesh, positions, radii, origins, delays, halves, radius };
  }

  function disposeModel(model) {
    root.remove(model.group);
    for (const mesh of [model.atomMesh, model.bondMesh]) {
      mesh.dispose();
      mesh.material.dispose();
    }
  }

  /** Places every atom and bond for the given moment. Returns true when the motion is over. */
  function poseModel(model, now) {
    const leavingNow = model.leftAt !== undefined;
    const duration = reducedMotion ? 150 : leavingNow ? SCATTER_MS : ASSEMBLE_MS;
    const t = clamp01((now - (leavingNow ? model.leftAt : model.bornAt)) / duration);

    model.positions.forEach((target, i) => {
      let position;
      let scale;
      if (leavingNow) {
        position = target.clone().multiplyScalar(1 + t * t * 2.2);
        scale = 1 - t;
      } else {
        const local = clamp01((t - model.delays[i]) / 0.5);
        position = model.origins[i].clone().lerp(target, easeOutExpo(local));
        scale = local <= 0 ? 0 : easeOutBack(clamp01(local * 1.4));
      }
      dummy.position.copy(position);
      dummy.quaternion.identity();
      dummy.scale.setScalar(Math.max(1e-4, model.radii[i] * scale));
      dummy.updateMatrix();
      model.atomMesh.setMatrixAt(i, dummy.matrix);
    });

    model.halves.forEach((half, i) => {
      const growth = leavingNow ? 0 : easeOutExpo(clamp01((t - half.ready) / 0.25));
      const span = half.to.clone().sub(half.from);
      const length = span.length();
      const width = (half.thin ? BOND_RADIUS * 0.72 : BOND_RADIUS) * (growth > 0 ? 1 : 0);
      dummy.position.copy(half.from).addScaledVector(span, growth / 2);
      dummy.quaternion.setFromUnitVectors(yAxis, span.normalize());
      dummy.scale.set(
        Math.max(1e-4, width),
        Math.max(1e-4, length * growth),
        Math.max(1e-4, width),
      );
      dummy.updateMatrix();
      model.bondMesh.setMatrixAt(i, dummy.matrix);
    });

    model.atomMesh.instanceMatrix.needsUpdate = true;
    model.bondMesh.instanceMatrix.needsUpdate = true;
    return t >= 1;
  }

  function setMolecule(data) {
    const now = performance.now();
    leaving.forEach(disposeModel);
    leaving = [];
    if (current) {
      current.leftAt = now;
      leaving.push(current);
    }
    current = buildModel(data);
    current.bornAt = now;
    root.add(current.group);
    glow.material.color.copy(tintOf(data.atoms));
    select(-1);
    resetView();
    lastInput = now - IDLE_BEFORE_SPIN_MS;
    poseModel(current, now);
  }

  function layout() {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    const pixelRatio = Math.min(devicePixelRatio || 1, QUALITY_STEPS[quality].pixelRatio);
    bloom.enabled = QUALITY_STEPS[quality].bloom;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    fit();
  }

  /** Sizes the molecule to the free area of the screen and keeps it clear of the panels. */
  function fit() {
    if (!current) return;
    const viewHeight = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const viewWidth = viewHeight * camera.aspect;
    const wide = camera.aspect > 1.2;
    const room = wide ? Math.min(viewHeight * 0.32, viewWidth * 0.25) : viewWidth * 0.4;
    fitScale = room / current.radius;
    pivot.position.set(wide ? viewWidth * 0.1 : 0, viewHeight * (wide ? 0.035 : -0.05), 0);
    root.scale.setScalar(fitScale * zoom);
    glow.scale.setScalar(current.radius * fitScale * zoom * 4.2);
  }

  function rotate(dx, dy) {
    spin.setFromAxisAngle(yAxis, dx);
    root.quaternion.premultiply(spin);
    spin.setFromAxisAngle(xAxis, dy);
    root.quaternion.premultiply(spin);
    lastInput = performance.now();
  }

  function scaleBy(factor) {
    zoom = THREE.MathUtils.clamp(zoom * factor, 0.4, 3);
    fit();
    lastInput = performance.now();
  }

  function resetView() {
    root.quaternion.setFromEuler(new THREE.Euler(0.18, -0.35, 0));
    zoom = 1;
    velocity = { x: 0, y: 0 };
    fit();
    lastInput = performance.now();
  }

  function select(index) {
    selected = index;
    outline.visible = index >= 0;
    atomLabel.hidden = index < 0;
    if (index < 0) return;
    const atom = current.data.atoms[index];
    outline.position.copy(current.positions[index]);
    outline.scale.setScalar(current.radii[index] * 1.16);
    atomLabel.textContent = `${element(atom.el).ja} ${atom.el}`;
  }

  /** Keeps the element label next to the selected atom while the molecule moves. */
  function placeAtomLabel() {
    if (selected < 0) return;
    const point = current.positions[selected].clone();
    root.localToWorld(point).project(camera);
    const { width, height } = host.getBoundingClientRect();
    atomLabel.style.transform = `translate(${((point.x + 1) / 2) * width}px, ${((1 - point.y) / 2) * height}px)`;
  }

  // Pointer input: one pointer rotates, two pointers zoom, a short tap selects an atom.
  const pointers = new Map();
  const raycaster = new THREE.Raycaster();
  let travelled = 0;
  let pinchDistance = 0;
  let lastTap = 0;

  const pointerSpread = () => {
    const [a, b] = [...pointers.values()];
    return b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    travelled = pointers.size > 1 ? Infinity : 0;
    pinchDistance = pointerSpread();
    velocity = { x: 0, y: 0 };
    lastInput = performance.now();
  });

  canvas.addEventListener('pointermove', (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    travelled += Math.hypot(dx, dy);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      velocity = { x: dx * 0.008, y: dy * 0.008 };
      rotate(velocity.x, velocity.y);
    } else {
      const spread = pointerSpread();
      if (pinchDistance > 0) scaleBy(spread / pinchDistance);
      pinchDistance = spread;
    }
  });

  function pickAtom(event) {
    const bounds = canvas.getBoundingClientRect();
    const point = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(point, camera);
    select(raycaster.intersectObject(current.atomMesh)[0]?.instanceId ?? -1);
  }

  function releasePointer(event) {
    if (!pointers.has(event.pointerId)) return;
    const wasTap = event.type === 'pointerup' && pointers.size === 1 && travelled < 6;
    pointers.delete(event.pointerId);
    pinchDistance = 0;
    if (pointers.size) travelled = Infinity;
    if (!wasTap || !current) return;
    const now = performance.now();
    if (now - lastTap < 320) resetView();
    else pickAtom(event);
    lastTap = now;
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, releasePointer);
  }
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      scaleBy(Math.exp(-event.deltaY * 0.0012));
    },
    { passive: false },
  );

  /** Lowers the rendering quality one step when the recent frames were slow on average. */
  function watchFrameTime(elapsed) {
    // Long gaps come from a hidden tab or a blocked main thread, not from slow rendering.
    if (elapsed > 250) return;
    slowness.total += elapsed;
    if (++slowness.frames < FRAMES_PER_CHECK) return;
    const average = slowness.total / slowness.frames;
    slowness = { total: 0, frames: 0 };
    if (average > SLOW_FRAME_MS && quality < QUALITY_STEPS.length - 1) {
      quality++;
      layout();
    }
  }

  function frame(now) {
    watchFrameTime(now - lastFrame);
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;

    if (current && !current.settled) {
      current.settled = poseModel(current, now);
      if (current.settled) flashStart = now;
    }
    leaving = leaving.filter((model) => {
      if (!poseModel(model, now)) return true;
      disposeModel(model);
      return false;
    });

    if (!pointers.size) {
      if (Math.abs(velocity.x) + Math.abs(velocity.y) > 1e-4) {
        const keepInput = lastInput;
        rotate(velocity.x * dt * 60, velocity.y * dt * 60);
        lastInput = keepInput;
        velocity.x *= Math.exp(-dt * 5);
        velocity.y *= Math.exp(-dt * 5);
      }
      if (!reducedMotion && now - lastInput > IDLE_BEFORE_SPIN_MS) {
        spin.setFromAxisAngle(yAxis, dt * 0.22);
        root.quaternion.premultiply(spin);
      }
    }

    // A short flash of light when the last bond closes.
    const flash = Math.exp(-(now - flashStart) / 260);
    bloom.strength = BLOOM_REST + (BLOOM_FLASH - BLOOM_REST) * flash;
    glow.material.opacity = 0.13 + 0.4 * flash;
    dust.rotation.y += dt * 0.012;
    dust.rotation.x += dt * 0.004;

    placeAtomLabel();
    composer.render();
    frameRequest = requestAnimationFrame(frame);
  }

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    cancelAnimationFrame(frameRequest);
    onFailure();
  });

  new ResizeObserver(layout).observe(host);
  layout();
  frameRequest = requestAnimationFrame(frame);

  return {
    setMolecule,
    reset: resetView,
    scaleBy,
    rotate(dx, dy) {
      velocity = { x: 0, y: 0 };
      rotate(dx, dy);
    },
  };
}
