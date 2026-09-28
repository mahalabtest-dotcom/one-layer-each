// The 3D stage: build plate, printer head, lights, camera and post-processing.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const PLATE = 10; // drawing footprint (world units)

function canvasTexture(w, h, draw, { repeat = null, srgb = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Side walls: rounded "beads" like the extruded lines of a real print.
export function makeBeadTexture(beadsPerLayer) {
  return canvasTexture(4, 64, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const t = y / h;
      const v = Math.round(255 * Math.pow(Math.sin(Math.PI * t), 0.55));
      for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    }
    g.putImageData(img, 0, 0);
  }, { repeat: [1, beadsPerLayer] });
}

// Top faces: faint diagonal infill lines.
export function makeInfillTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    const lines = 4;
    // diagonal ridges with a soft rounded profile
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = ((x + y) % (w / lines)) / (w / lines);
      const v = Math.round(255 * Math.pow(Math.sin(Math.PI * d), 0.6));
      const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { repeat: [26, 26] });
}

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  scene.background = canvasTexture(1024, 1024, (g, w, h) => {
    const r = g.createRadialGradient(w * 0.55, h * 0.42, 0, w * 0.55, h * 0.45, w * 0.75);
    r.addColorStop(0, '#232838'); r.addColorStop(0.45, '#12151e'); r.addColorStop(1, '#06070a');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  }, { srgb: true });

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(17, 12, 19);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 8;
  controls.maxDistance = 60;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;

  // lights
  scene.add(new THREE.HemisphereLight('#c9d6ff', '#1d1626', 0.55));
  const key = new THREE.DirectionalLight('#fff1e0', 2.1);
  key.position.set(9, 18, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#7aa7ff', 1.6);
  rim.position.set(-12, 9, -12);
  scene.add(rim);
  const warm = new THREE.DirectionalLight('#ff9d6b', 0.5);
  warm.position.set(-8, 3, 12);
  scene.add(warm);

  // floor (soft pool of light that receives shadows)
  const floorTex = canvasTexture(512, 512, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(0.3, 'rgba(255,255,255,.4)'); r.addColorStop(0.7, 'rgba(255,255,255,0)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(26, 96),
    new THREE.MeshBasicMaterial({ color: '#27304a', alphaMap: floorTex, transparent: true, depthWrite: false, opacity: 0.45 }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.63;
  scene.add(glow);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.ShadowMaterial({ opacity: 0.5, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.62;
  floor.receiveShadow = true;
  scene.add(floor);

  // build plate
  const plateSize = PLATE + 2.4;
  const plateTop = canvasTexture(1024, 1024, (g, w, h) => {
    g.fillStyle = '#1c1f27'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 22;
      img.data[i] += n + 4; img.data[i + 1] += n + 2; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 2;
    const step = w / 12;
    for (let k = 1; k < 12; k++) { g.beginPath(); g.moveTo(k * step, 0); g.lineTo(k * step, h); g.stroke(); g.beginPath(); g.moveTo(0, k * step); g.lineTo(w, k * step); g.stroke(); }
    g.strokeStyle = 'rgba(255,177,59,.55)'; g.lineWidth = 5;
    const m = 18, L = 70;
    [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]].forEach(([x, y, sx, sy]) => {
      g.beginPath(); g.moveTo(x + sx * L, y); g.lineTo(x, y); g.lineTo(x, y + sy * L); g.stroke();
    });
    g.fillStyle = 'rgba(255,255,255,.22)'; g.font = '500 22px monospace';
    g.fillText('ONE LAYER EACH · BUILD PLATE', 36, h - 36);
  }, { srgb: true });
  const plate = new THREE.Group();
  const plateBody = new THREE.Mesh(
    new THREE.BoxGeometry(plateSize, 0.5, plateSize),
    [
      new THREE.MeshStandardMaterial({ color: '#2a2e38', roughness: 0.35, metalness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: '#2a2e38', roughness: 0.35, metalness: 0.85 }),
      new THREE.MeshStandardMaterial({ map: plateTop, roughness: 0.75, metalness: 0.2 }),
      new THREE.MeshStandardMaterial({ color: '#15171d', roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: '#2a2e38', roughness: 0.35, metalness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: '#2a2e38', roughness: 0.35, metalness: 0.85 }),
    ],
  );
  plateBody.position.y = -0.25 - 0.002;
  plateBody.receiveShadow = true;
  plateBody.castShadow = true;
  plate.add(plateBody);
  // glowing edge strip
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(plateSize + 0.06, 0.05, plateSize + 0.06),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a2e').multiplyScalar(2.6), toneMapped: false }),
  );
  edge.position.y = -0.36;
  plate.add(edge);
  scene.add(plate);

  // printer head + gantry
  const rig = createRig(plateSize);
  scene.add(rig.group);

  // post-processing
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.45, 1.25);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, controls, composer, rig, plate, key, resize };
}

function createRig(plateSize) {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#3a3f4b', roughness: 0.3, metalness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: '#15171d', roughness: 0.5, metalness: 0.4 });
  const brass = new THREE.MeshStandardMaterial({ color: '#d9a441', roughness: 0.25, metalness: 1 });
  const accent = new THREE.MeshStandardMaterial({ color: '#ff6b2c', roughness: 0.4, metalness: 0.1, emissive: '#ff5a1a', emissiveIntensity: 0.25 });

  // gantry rail (follows nozzle in z and layer height in y)
  const gantry = new THREE.Group();
  const rail = new THREE.Mesh(new THREE.BoxGeometry(plateSize + 3.2, 0.22, 0.34), metal);
  rail.position.y = 1.55;
  rail.castShadow = true;
  gantry.add(rail);
  for (const s of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.7), dark);
    end.position.set(s * (plateSize / 2 + 1.6), 1.55, 0);
    end.castShadow = true;
    gantry.add(end);
  }
  group.add(gantry);

  // print head (origin = nozzle tip)
  const head = new THREE.Group();
  const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 0.62), dark);
  carriage.position.y = 1.55; carriage.castShadow = true;
  head.add(carriage);
  const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 32), accent);
  fan.rotation.x = Math.PI / 2; fan.position.set(0, 1.5, 0.33);
  head.add(fan);
  const sink = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.55, 20), metal);
  sink.position.y = 0.95; sink.castShadow = true;
  head.add(sink);
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 24), metal);
    fin.position.y = 0.78 + k * 0.1;
    head.add(fin);
  }
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.42), new THREE.MeshStandardMaterial({ color: '#b9bec9', roughness: 0.35, metalness: 0.95 }));
  block.position.y = 0.5; block.castShadow = true;
  head.add(block);
  const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.3, 24), brass);
  nozzle.rotation.x = Math.PI; nozzle.position.y = 0.23;
  head.add(nozzle);
  const tipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff8a3d').multiplyScalar(3), toneMapped: false });
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), tipMat);
  tip.position.y = 0.06;
  head.add(tip);
  const light = new THREE.PointLight('#ff7a2e', 0, 4, 1.6);
  light.position.y = 0.1;
  head.add(light);
  group.add(head);

  return {
    group, head, gantry, tipMat, light,
    setPosition(x, y, z) {
      head.position.set(x, y, z);
      gantry.position.set(0, y, z);
    },
    setHeat(v) {
      light.intensity = v * 6;
      tipMat.color.setRGB(1, 0.54, 0.24).multiplyScalar(0.6 + v * 3);
    },
  };
}
