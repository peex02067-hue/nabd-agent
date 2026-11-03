// Interactive 3D emoji avatar built procedurally with three.js.
// API: setState(idle|listening|thinking|working|speaking), setMood(name), setSkin(hex), react(), onTap
import * as THREE from 'three';

const R = 1.2; // head radius

const MOODS = {
  neutral:   { smile: 0.55, open: 0,   brow: 0,     tilt: 0,     eyeL: 1,    eyeR: 1,    blush: 0.12, asym: 0 },
  happy:     { smile: 1,    open: 0,   brow: 0.06,  tilt: 0,     eyeL: 0.5,  eyeR: 0.5,  blush: 0.6,  asym: 0 },
  love:      { smile: 1,    open: 0,   brow: 0.05,  tilt: 0.12,  eyeL: 0.45, eyeR: 0.45, blush: 0.95, asym: 0 },
  sad:       { smile: -0.8, open: 0,   brow: 0.02,  tilt: 0.38,  eyeL: 0.85, eyeR: 0.85, blush: 0,    asym: 0 },
  surprised: { smile: 0,    open: 0.9, brow: 0.14,  tilt: 0,     eyeL: 1.3,  eyeR: 1.3,  blush: 0.1,  asym: 0 },
  thinking:  { smile: 0.1,  open: 0,   brow: 0.03,  tilt: -0.12, eyeL: 0.9,  eyeR: 0.9,  blush: 0,    asym: 0.12 },
  attentive: { smile: 0.45, open: 0,   brow: 0.09,  tilt: 0,     eyeL: 1.12, eyeR: 1.12, blush: 0.15, asym: 0 },
  wink:      { smile: 0.95, open: 0,   brow: 0.04,  tilt: 0,     eyeL: 1,    eyeR: 0.08, blush: 0.45, asym: 0 },
  angry:     { smile: -0.6, open: 0,   brow: -0.05, tilt: -0.45, eyeL: 0.8,  eyeR: 0.8,  blush: 0,    asym: 0 },
};

const STATE_FX = {
  idle:      { color: 0x4fd1ff, ring: 0.35, orbs: 0, glow: 1.2 },
  listening: { color: 0x5dffa1, ring: 0.9,  orbs: 0, glow: 2.2 },
  thinking:  { color: 0xa77bff, ring: 1.8,  orbs: 1, glow: 2.4 },
  working:   { color: 0xffa94f, ring: 2.8,  orbs: 1, glow: 2.8 },
  speaking:  { color: 0x4fd1ff, ring: 0.6,  orbs: 0, glow: 1.8 },
};

function radialTexture(inner, outer = 'rgba(0,0,0,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createAvatar(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  if (!renderer.getContext()) throw new Error('WebGL unavailable');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 6.8);

  scene.add(new THREE.HemisphereLight(0xdff3ff, 0x40305a, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(2.5, 3.5, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7cdcff, 1.8);
  rim.position.set(-4, 2, -3);
  scene.add(rim);
  const fill = new THREE.PointLight(0xff8ad8, 8, 12);
  fill.position.set(3, -2, 2.5);
  scene.add(fill);

  const root = new THREE.Group();  // float / bounce
  const head = new THREE.Group();  // look / spin
  root.add(head);
  scene.add(root);

  // ---------- head ----------
  const headGeo = new THREE.SphereGeometry(R, 64, 48);
  const headMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.32, clearcoat: 0.85, clearcoatRoughness: 0.12, sheen: 0.3, sheenColor: 0xffffff,
  });
  head.add(new THREE.Mesh(headGeo, headMat));

  function paintSkin(hex) {
    const base = new THREE.Color(hex);
    const dark = base.clone().multiplyScalar(0.7);
    const pos = headGeo.attributes.position;
    const arr = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / R;
      const f = THREE.MathUtils.smoothstep(y, -1, 0.65);
      c.copy(dark).lerp(base, f);
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
    headGeo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  paintSkin('#ffc83d');

  // place an object on the sphere surface, local +z facing outward
  function onSurface(obj, x, y, lift = 0) {
    const z = Math.sqrt(Math.max(R * R - x * x - y * y, 0));
    const n = new THREE.Vector3(x, y, z).normalize();
    obj.position.copy(n.clone().multiplyScalar(R + lift));
    obj.lookAt(n.clone().multiplyScalar(10));
    head.add(obj);
  }

  // ---------- eyes ----------
  const featureMat = new THREE.MeshPhysicalMaterial({ color: 0x2a1a10, roughness: 0.15, clearcoat: 1 });
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  function makeEye(x) {
    const g = new THREE.Group();
    onSurface(g, x, 0.22, -0.03);
    const inner = new THREE.Group();
    g.add(inner);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 24), featureMat);
    ball.scale.set(1, 1.45, 0.55);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 12), hlMat);
    hl.position.set(-0.05, 0.09, 0.075);
    inner.add(ball, hl);
    return inner;
  }
  const eyeL = makeEye(-0.42);
  const eyeR = makeEye(0.42);

  // ---------- brows ----------
  const browMat = new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.5 });
  function makeBrow(x) {
    const g = new THREE.Group();
    onSurface(g, x, 0.58, 0.005);
    const pivot = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.2, 6, 12), browMat);
    m.rotation.z = Math.PI / 2;
    pivot.add(m);
    g.add(pivot);
    return pivot;
  }
  const browL = makeBrow(-0.42);
  const browR = makeBrow(0.42);

  // ---------- mouth ----------
  const mouth = new THREE.Group();
  onSurface(mouth, 0, -0.32, 0);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 16, 48, Math.PI), browMat);
  smile.position.z = 0.03;
  const openMouth = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0x4a1418, roughness: 0.6 })
  );
  openMouth.position.y = -0.1;
  mouth.add(smile, openMouth);

  // ---------- cheeks ----------
  const blushMat = new THREE.MeshBasicMaterial({
    map: radialTexture('rgba(255,95,130,1)'), transparent: true, opacity: 0, depthWrite: false,
  });
  for (const x of [-0.66, 0.66]) {
    const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.2, 32), blushMat);
    onSurface(cheek, x, -0.12, 0.02);
  }

  // ---------- antenna ----------
  const antenna = new THREE.Group();
  antenna.position.y = R - 0.03;
  head.add(antenna);
  const stalk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.035, 0.36, 12),
    new THREE.MeshStandardMaterial({ color: 0x9aa4c8, metalness: 0.6, roughness: 0.3 })
  );
  stalk.position.y = 0.18;
  const tipMat = new THREE.MeshStandardMaterial({ color: 0x4fd1ff, emissive: 0x4fd1ff, emissiveIntensity: 1.5 });
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 24, 16), tipMat);
  tip.position.y = 0.4;
  const tipLight = new THREE.PointLight(0x4fd1ff, 1.5, 3);
  tip.add(tipLight);
  const tipGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture('rgba(255,255,255,0.9)'), color: 0x4fd1ff, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  tipGlow.scale.setScalar(0.55);
  tip.add(tipGlow);
  antenna.add(stalk, tip);

  // ---------- holo ring + orbs ----------
  const ringGroup = new THREE.Group();
  ringGroup.rotation.set(-1.35, 0.2, 0); // orbit passes under the chin, never across the face
  ringGroup.position.y = -0.8;
  root.add(ringGroup);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x4fd1ff, transparent: true, opacity: 0.55 });
  ringGroup.add(new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.016, 8, 160), ringMat));
  const orbMat = new THREE.MeshBasicMaterial({ color: 0x4fd1ff, transparent: true, opacity: 0 });
  const orbs = [0, 1, 2].map(i => {
    const o = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), orbMat);
    const a = (i / 3) * Math.PI * 2;
    o.position.set(Math.cos(a) * 1.72, Math.sin(a) * 1.72, 0);
    ringGroup.add(o);
    return o;
  });

  // ---------- ground shadow ----------
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 0.45),
    new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.55)'), transparent: true, depthWrite: false })
  );
  shadow.position.set(0, -1.75, -0.5);
  scene.add(shadow);

  // ---------- state ----------
  let state = 'idle';
  let mood = 'neutral';
  let tapUntil = 0;
  const cur = { ...MOODS.neutral };
  const fxColor = new THREE.Color(STATE_FX.idle.color);
  let ringSpeed = STATE_FX.idle.ring, orbAlpha = 0, glow = STATE_FX.idle.glow;

  // gaze & interaction
  const pointer = { x: 0, y: 0, last: 0 };
  const gaze = { x: 0, y: 0 };
  const wander = { x: 0, y: 0, next: 0 };
  let dragging = false, downX = 0, downY = 0, lastX = 0, moved = 0;
  let spin = 0, spinVel = 0;
  let bounceT = -1;
  let blinkT = 0, nextBlink = 2 + Math.random() * 3;

  const api = { onTap: null };

  function toLocal(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: THREE.MathUtils.clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1.5, 1.5),
      y: THREE.MathUtils.clamp(-(((e.clientY - r.top) / r.height) * 2 - 1), -1.5, 1.5),
    };
  }
  window.addEventListener('pointermove', e => {
    const p = toLocal(e);
    pointer.x = p.x; pointer.y = p.y; pointer.last = performance.now();
    if (dragging) {
      const dx = e.clientX - lastX;
      spin += dx * 0.012;
      spinVel = dx * 0.012;
      moved += Math.abs(dx) + Math.abs(e.clientY - downY) * 0.1;
      lastX = e.clientX;
    }
  }, { passive: true });
  canvas.addEventListener('pointerdown', e => {
    dragging = true; moved = 0; downX = lastX = e.clientX; downY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    const p = toLocal(e); pointer.x = p.x; pointer.y = p.y; pointer.last = performance.now();
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    if (moved < 8) { react(); if (api.onTap) api.onTap(); }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', () => { dragging = false; });

  function react() {
    bounceT = 0;
    tapUntil = performance.now() + 1600;
  }

  function effectiveMood() {
    if (performance.now() < tapUntil) return 'happy';
    if (state === 'thinking' || state === 'working') return 'thinking';
    if (state === 'listening') return 'attentive';
    return mood;
  }

  // ---------- loop ----------
  const clock = new THREE.Clock();
  let t = 0;
  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    t += dt;
    const now = performance.now();
    const k = 1 - Math.exp(-dt * 9);

    // mood params
    const target = MOODS[effectiveMood()] || MOODS.neutral;
    for (const key in cur) cur[key] += (target[key] - cur[key]) * k;

    // state fx
    const fx = STATE_FX[state] || STATE_FX.idle;
    fxColor.lerp(new THREE.Color(fx.color), k);
    ringSpeed += (fx.ring - ringSpeed) * k;
    orbAlpha += (fx.orbs - orbAlpha) * k;
    glow += (fx.glow - glow) * k;
    tipMat.color.copy(fxColor); tipMat.emissive.copy(fxColor); tipMat.emissiveIntensity = glow;
    tipLight.color.copy(fxColor); tipGlow.material.color.copy(fxColor);
    tipGlow.scale.setScalar(0.45 + 0.1 * Math.sin(t * (state === 'idle' ? 2 : 6)) + glow * 0.05);
    ringMat.color.copy(fxColor); orbMat.color.copy(fxColor); orbMat.opacity = orbAlpha;
    ringGroup.rotation.z += ringSpeed * dt;
    orbs.forEach((o, i) => o.scale.setScalar(0.8 + 0.4 * Math.sin(t * 5 + i * 2)));

    // gaze target
    let gx, gy;
    if (state === 'thinking' || state === 'working') { gx = -0.45 + 0.1 * Math.sin(t * 0.8); gy = 0.55; }
    else if (now - pointer.last < 3000) { gx = pointer.x; gy = pointer.y; }
    else {
      if (t > wander.next) { wander.x = (Math.random() - 0.5) * 1.0; wander.y = (Math.random() - 0.5) * 0.6; wander.next = t + 1.5 + Math.random() * 2.5; }
      gx = wander.x; gy = wander.y;
    }
    const gk = 1 - Math.exp(-dt * 6);
    gaze.x += (gx - gaze.x) * gk; gaze.y += (gy - gaze.y) * gk;

    // spin from drag, then settle back to front
    if (!dragging) {
      spin += spinVel; spinVel *= 0.92;
      if (Math.abs(spinVel) < 0.002) {
        const home = Math.round(spin / (Math.PI * 2)) * Math.PI * 2;
        spin += (home - spin) * (1 - Math.exp(-dt * 5));
      }
    }
    head.rotation.y = gaze.x * 0.38 + spin;
    head.rotation.x = -gaze.y * 0.25;
    head.rotation.z = Math.sin(t * 0.7) * 0.03 + (state === 'thinking' ? 0.08 : 0);

    // eyes: gaze offset + blink
    blinkT += dt;
    let blink = 1;
    if (blinkT > nextBlink) {
      const p = (blinkT - nextBlink) / 0.16;
      blink = p < 1 ? Math.abs(Math.cos(p * Math.PI)) * 0.92 + 0.08 : 1;
      if (p >= 1) { blinkT = 0; nextBlink = 2 + Math.random() * 4; }
    }
    for (const [eye, s] of [[eyeL, cur.eyeL], [eyeR, cur.eyeR]]) {
      eye.position.x = THREE.MathUtils.clamp(gaze.x, -1, 1) * 0.05;
      eye.position.y = THREE.MathUtils.clamp(gaze.y, -1, 1) * 0.045;
      eye.scale.y = Math.max(0.06, s * blink);
      eye.scale.x = 1 + (1 - Math.min(s, 1)) * 0.12;
    }

    // brows
    browL.position.y = cur.brow;
    browR.position.y = cur.brow + cur.asym;
    browL.rotation.z = cur.tilt;
    browR.rotation.z = -cur.tilt;

    // mouth
    let open = cur.open;
    if (state === 'speaking') {
      open = Math.max(open, 0.12 + 0.5 * Math.abs(Math.sin(t * 13)) * (0.6 + 0.4 * Math.sin(t * 3.7)));
    }
    const s = cur.smile;
    const sy = Math.max(Math.abs(s) * 0.7, 0.06) * (s >= 0 ? -1 : 1);
    smile.scale.set(1, sy, 1);
    smile.visible = open < 0.3;
    openMouth.visible = open > 0.02;
    openMouth.scale.set(1 - open * 0.35, Math.max(open * 0.9, 0.01), 0.35);
    blushMat.opacity = cur.blush * 0.75;

    // float, bounce, squash
    let y = -0.12 + Math.sin(t * 1.6) * 0.06;
    let sq = 1;
    if (bounceT >= 0) {
      bounceT += dt;
      const p = bounceT / 0.55;
      if (p >= 1) bounceT = -1;
      else { y += Math.sin(p * Math.PI) * 0.4; sq = 1 + Math.sin(p * Math.PI * 2) * 0.06; }
    }
    const breathe = 1 + Math.sin(t * 1.6) * 0.008;
    root.position.y = y;
    root.scale.set(breathe / Math.sqrt(sq), breathe * sq, breathe / Math.sqrt(sq));
    antenna.rotation.z = Math.sin(t * 2.3) * 0.08 - spinVel * 2 + (bounceT >= 0 ? Math.sin(bounceT * 30) * 0.15 : 0);
    const shadowScale = 1 - (y + 0.12) * 0.8;
    shadow.scale.set(shadowScale, shadowScale, 1);
    shadow.material.opacity = 0.9 * shadowScale;

    renderer.render(scene, camera);
  }
  frame();

  api.setState = s => { if (STATE_FX[s]) state = s; };
  api.setMood = m => { mood = MOODS[m] ? m : 'neutral'; };
  api.setSkin = hex => { try { paintSkin(hex || '#ffc83d'); } catch (_) {} };
  api.react = react;
  api.moods = Object.keys(MOODS);
  return api;
}
