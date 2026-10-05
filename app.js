import * as THREE from 'three';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------------------
// Worksheet layout. Units match worksheet.png: the sheet is PW wide and PH tall,
// centred on the origin. x runs left to right, z runs top to bottom of the sheet,
// y points up out of the paper.
// ---------------------------------------------------------------------------
const PW = 10, PH = 7.07;
const L = -3.6, R = 3.6, T = -2.2, B = 2.2;
const SW_X = -1.4, BA_X = 1.6;

const state = { V: 6, Rb: 6, Rv: 6, closed: true, mode: 'electron', I: 0 };

// ---------------------------------------------------------------------------
// Circuit solver (modified nodal analysis). Works for any network of resistors
// and voltage sources, so new worksheets only need a new netlist.
// ---------------------------------------------------------------------------
function gauss(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}
// Node 0 is ground. Elements: {type:'R', a, b, r} or {type:'V', a: + node, b: - node, v}
function solve(nNodes, elements) {
  const sources = elements.filter(e => e.type === 'V');
  const n = nNodes - 1, N = n + sources.length;
  const A = Array.from({ length: N }, () => new Array(N).fill(0));
  const z = new Array(N).fill(0);
  const k = node => node - 1;
  for (const e of elements) {
    if (e.type !== 'R') continue;
    const g = 1 / e.r;
    if (e.a) A[k(e.a)][k(e.a)] += g;
    if (e.b) A[k(e.b)][k(e.b)] += g;
    if (e.a && e.b) { A[k(e.a)][k(e.b)] -= g; A[k(e.b)][k(e.a)] -= g; }
  }
  sources.forEach((e, j) => {
    const r = n + j;
    if (e.a) { A[k(e.a)][r] += 1; A[r][k(e.a)] += 1; }
    if (e.b) { A[k(e.b)][r] -= 1; A[r][k(e.b)] -= 1; }
    z[r] = e.v;
  });
  const x = gauss(A, z);
  return [0, ...x.slice(0, n)];
}

// ---------------------------------------------------------------------------
// 3D circuit (built once, used by both the 3D view and the AR view)
// ---------------------------------------------------------------------------
function canvasTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildCircuit() {
  const root = new THREE.Group();
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };

  const copper = new THREE.MeshStandardMaterial({ color: 0xB8743A, metalness: 0.6, roughness: 0.35 });
  const brass  = new THREE.MeshStandardMaterial({ color: 0xC9A24A, metalness: 0.7, roughness: 0.3 });
  const steel  = new THREE.MeshStandardMaterial({ color: 0xB9BEC4, metalness: 0.8, roughness: 0.3 });
  const dark   = new THREE.MeshStandardMaterial({ color: 0x34414F, roughness: 0.6 });
  const inkMat = new THREE.MeshStandardMaterial({ color: 0x1D2B3A, roughness: 0.5 });

  // Wires
  function wire(x1, z1, x2, z2) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 8), copper, (x1 + x2) / 2, 0.05, (z1 + z2) / 2);
    if (Math.abs(x2 - x1) > Math.abs(z2 - z1)) m.rotation.z = Math.PI / 2; else m.rotation.x = Math.PI / 2;
    root.add(m);
  }
  wire(L, T, SW_X - 0.4, T); wire(SW_X + 0.4, T, R, T); wire(R, T, R, B); wire(R, B, L, B); wire(L, B, L, T);
  for (const [x, z] of [[L, T], [R, T], [R, B], [L, B]]) root.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), copper, x, 0.05, z));

  // Cell (positive end towards the top of the sheet)
  const cell = new THREE.Group(); cell.position.set(L, 0, 0);
  const along = m => { m.rotation.x = Math.PI / 2; return m; };
  cell.add(along(mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.2, 32), inkMat, 0, 0.32, 0)));
  cell.add(along(mesh(new THREE.CylinderGeometry(0.305, 0.305, 0.3, 32), brass, 0, 0.32, -0.45)));
  cell.add(along(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.14, 20), steel, 0, 0.32, -0.66)));
  cell.add(along(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 24), steel, 0, 0.32, 0.61)));
  root.add(cell);

  // Switch
  const sw = new THREE.Group(); sw.position.set(SW_X, 0, T);
  sw.add(mesh(new THREE.BoxGeometry(1.2, 0.08, 0.45), new THREE.MeshStandardMaterial({ color: 0xC8CED6, roughness: 0.7 }), 0, 0.04, 0));
  sw.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 16), brass, -0.4, 0.19, 0));
  sw.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 16), brass, 0.4, 0.19, 0));
  const lever = new THREE.Group(); lever.position.set(-0.4, 0.3, 0);
  lever.add(mesh(new THREE.BoxGeometry(0.84, 0.045, 0.1), brass, 0.42, 0, 0));
  lever.add(mesh(new THREE.SphereGeometry(0.07, 14, 10), new THREE.MeshStandardMaterial({ color: 0xE0484E, roughness: 0.5 }), 0.84, 0.05, 0));
  sw.add(lever); root.add(sw);

  // Bulbs
  const gc = document.createElement('canvas'); gc.width = gc.height = 128;
  const gg = gc.getContext('2d');
  const grd = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,225,150,1)'); grd.addColorStop(0.35, 'rgba(255,200,110,0.45)'); grd.addColorStop(1, 'rgba(255,190,90,0)');
  gg.fillStyle = grd; gg.fillRect(0, 0, 128, 128);
  const glowTex = canvasTexture(gc);

  function makeBulb(x, z) {
    const grp = new THREE.Group(); grp.position.set(x, 0, z);
    grp.add(mesh(new THREE.BoxGeometry(0.7, 0.22, 0.7), dark, 0, 0.11, 0));
    grp.add(mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.26, 24), steel, 0, 0.35, 0));
    const fil = mesh(new THREE.TorusGeometry(0.09, 0.016, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0x553322, emissive: 0xFFB347, emissiveIntensity: 0.1 }), 0, 0.76, 0);
    grp.add(fil);
    for (const dx of [-0.08, 0.08]) grp.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), steel, dx, 0.6, 0));
    const glass = mesh(new THREE.SphereGeometry(0.38, 32, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, roughness: 0.1, emissive: 0xFFD27A, emissiveIntensity: 0 }), 0, 0.78, 0);
    grp.add(glass);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    glow.position.set(0, 0.78, 0); grp.add(glow);
    root.add(grp);
    return {
      set(b) {
        fil.material.emissiveIntensity = 0.1 + b * 2.5;
        glass.material.emissiveIntensity = b * 0.9;
        glow.material.opacity = b;
        glow.scale.setScalar(0.3 + b * 2.4);
      }
    };
  }
  const bulbA = makeBulb(BA_X, T);
  const bulbB = makeBulb(R, 0);

  // Variable resistor
  const rc = document.createElement('canvas'); rc.width = 256; rc.height = 16;
  const rg = rc.getContext('2d');
  rg.fillStyle = '#D8C9A6'; rg.fillRect(0, 0, 256, 16);
  rg.fillStyle = '#A8662F'; for (let i = 0; i < 256; i += 8) rg.fillRect(i, 0, 4, 16);
  const rheo = new THREE.Group(); rheo.position.set(0, 0, B);
  rheo.add(mesh(new THREE.BoxGeometry(1.5, 0.32, 0.42), new THREE.MeshStandardMaterial({ map: canvasTexture(rc), roughness: 0.6 }), 0, 0.16, 0));
  rheo.add(mesh(new THREE.BoxGeometry(1.5, 0.04, 0.06), steel, 0, 0.42, 0));
  rheo.add(mesh(new THREE.BoxGeometry(0.1, 0.46, 0.5), dark, -0.8, 0.23, 0));
  rheo.add(mesh(new THREE.BoxGeometry(0.1, 0.46, 0.5), dark, 0.8, 0.23, 0));
  const slider = mesh(new THREE.BoxGeometry(0.16, 0.16, 0.5), inkMat, 0, 0.42, 0);
  rheo.add(slider); root.add(rheo);

  // Moving charges. Conventional current runs round the corners in this order,
  // out of the + terminal at the top of the cell and back into the - terminal.
  const corners = [[L, T], [R, T], [R, B], [L, B]];
  const segs = []; let loopLen = 0;
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % 4], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, len, start: loopLen }); loopLen += len;
  });
  function pointAt(s) {
    s = ((s % loopLen) + loopLen) % loopLen;
    for (const sg of segs) {
      if (s <= sg.start + sg.len) {
        const t = (s - sg.start) / sg.len;
        return [sg.a[0] + (sg.b[0] - sg.a[0]) * t, sg.a[1] + (sg.b[1] - sg.a[1]) * t];
      }
    }
    return corners[0];
  }
  const chargeMat = new THREE.MeshStandardMaterial({ color: 0x2F9BFF, emissive: 0x2F9BFF, emissiveIntensity: 0.6 });
  const chargeGeo = new THREE.SphereGeometry(0.085, 12, 10);
  const NC = 72, charges = [];
  for (let i = 0; i < NC; i++) { const m = new THREE.Mesh(chargeGeo, chargeMat); root.add(m); charges.push(m); }

  let offset = 0;
  return {
    root,
    setBrightness(a, b) { bulbA.set(a); bulbB.set(b); },
    setChargeColour(hex) { chargeMat.color.setHex(hex); chargeMat.emissive.setHex(hex); },
    tick(dt) {
      const speed = Math.min(Math.abs(state.I) * 2.2, 7) * (state.mode === 'electron' ? -1 : 1);
      offset += speed * dt;
      for (let i = 0; i < NC; i++) {
        const p = pointAt(i * loopLen / NC + offset);
        charges[i].position.set(p[0], 0.12, p[1]);
      }
      const k = Math.min(1, dt * 10);
      lever.rotation.z += ((state.closed ? 0 : 0.6) - lever.rotation.z) * k;
      slider.position.x += ((-0.6 + 1.2 * (state.Rv / 30)) - slider.position.x) * k;
    }
  };
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 8, 4);
  scene.add(sun);
}

// ---------------------------------------------------------------------------
// Physics -> visuals and readings
// ---------------------------------------------------------------------------
let circuit = null;
const fmt = (x, unit) => (Math.abs(x) > 0 && Math.abs(x) < 0.01 ? x.toFixed(3) : x.toFixed(2)) + ' ' + unit;

function compute() {
  const Rsw = state.closed ? 1e-3 : 1e9;
  // Nodes: 0 = cell -, 1 = cell +, 2 = after switch, 3 = between bulbs, 4 = before variable resistor
  const V = solve(5, [
    { type: 'V', a: 1, b: 0, v: state.V },
    { type: 'R', a: 1, b: 2, r: Rsw },
    { type: 'R', a: 2, b: 3, r: state.Rb },
    { type: 'R', a: 3, b: 4, r: state.Rb },
    { type: 'R', a: 4, b: 0, r: Math.max(state.Rv, 1e-3) }
  ]);
  let I = (V[1] - V[2]) / Rsw;
  if (Math.abs(I) < 1e-6) I = 0;
  state.I = I;
  const vA = V[2] - V[3], vB = V[3] - V[4], vR = V[4] - V[0], vS = V[1] - V[2];
  const pA = vA * I, pB = vB * I;
  if (circuit) circuit.setBrightness(1 - Math.exp(-pA / 1.5), 1 - Math.exp(-pB / 1.5));
  $('oI').textContent = fmt(I, 'A');
  $('oVA').textContent = fmt(vA, 'V');
  $('oVB').textContent = fmt(vB, 'V');
  $('oVR').textContent = fmt(vR, 'V');
  $('oVS').textContent = fmt(Math.abs(vS) < 0.005 ? 0 : vS, 'V');
  $('oRT').textContent = state.closed ? fmt(2 * state.Rb + state.Rv, '\u03A9') : 'Circuit broken';
  $('oP').textContent = fmt(pA, 'W');
}

function setMode(mode) {
  state.mode = mode;
  $('mElectron').setAttribute('aria-pressed', mode === 'electron');
  $('mConv').setAttribute('aria-pressed', mode === 'conv');
  if (circuit) circuit.setChargeColour(mode === 'electron' ? 0x2F9BFF : 0xE0484E);
  $('legend').innerHTML = mode === 'electron'
    ? '<span class="dot" style="background:var(--electron)"></span>Blue dots are electrons. They drift out of the negative terminal, round the circuit, and back into the positive terminal.'
    : '<span class="dot" style="background:var(--conv)"></span>Red dots show conventional current: the direction positive charge would flow, from + round to \u2212. It is the opposite way to the electrons.';
}

function bindControls() {
  const bindRange = (id, key, unit) => {
    const el = $(id), out = $(id + 'Out');
    const update = () => { state[key] = parseFloat(el.value); out.textContent = state[key] + ' ' + unit; compute(); };
    el.addEventListener('input', update); update();
  };
  bindRange('volt', 'V', 'V');
  bindRange('rb', 'Rb', '\u03A9');
  bindRange('rv', 'Rv', '\u03A9');

  $('sw').addEventListener('click', () => {
    state.closed = !state.closed;
    $('sw').textContent = state.closed ? 'Open the switch' : 'Close the switch';
    compute();
  });
  $('mElectron').addEventListener('click', () => setMode('electron'));
  $('mConv').addEventListener('click', () => setMode('conv'));
  $('toggleVals').addEventListener('click', () => {
    const t = $('vals'); t.hidden = !t.hidden;
    $('toggleVals').textContent = t.hidden ? 'Show readings' : 'Hide readings';
  });
  $('collapse').addEventListener('click', () => {
    const p = $('panel'); p.classList.toggle('collapsed');
    const open = !p.classList.contains('collapsed');
    $('collapse').textContent = open ? 'Hide controls' : 'Show controls';
    $('collapse').setAttribute('aria-expanded', open);
    window.dispatchEvent(new Event('resize')); // lets the camera view refit
  });
  $('back').addEventListener('click', () => { location.href = location.pathname; });
  setMode('electron');
}

// ---------------------------------------------------------------------------
// 3D view (no camera)
// ---------------------------------------------------------------------------
function start3D() {
  const view = $('view');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  view.insertBefore(renderer.domElement, view.firstChild);
  const el = renderer.domElement;
  el.style.width = '100%'; el.style.height = '100%'; el.style.cursor = 'grab';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2C3A47');
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  addLights(scene);

  const sheetTex = new THREE.TextureLoader().load('worksheet.png');
  sheetTex.colorSpace = THREE.SRGBColorSpace;
  sheetTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshStandardMaterial({ map: sheetTex, roughness: 0.95 }));
  paper.rotation.x = -Math.PI / 2;
  scene.add(paper);
  scene.add(circuit.root);

  // Drag to orbit, pinch or scroll to zoom
  const cam = { theta: 0, phi: 0.8, r: 12 };
  const pts = new Map(); let pinch = null;
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); });
  el.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) {
      cam.theta -= (e.clientX - prev[0]) * 0.008;
      cam.phi = clamp(cam.phi - (e.clientY - prev[1]) * 0.006, 0.12, 1.35);
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) cam.r = clamp(cam.r * pinch / d, 5, 26);
      pinch = d;
    }
  });
  const release = e => { pts.delete(e.pointerId); pinch = null; };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('wheel', e => { e.preventDefault(); cam.r = clamp(cam.r * (1 + e.deltaY * 0.001), 5, 26); }, { passive: false });

  let fitted = false;
  function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (!fitted) { const a = w / h; cam.r = a >= 1.4 ? 12 : clamp(12 * 1.4 / a * 0.85, 12, 24); fitted = true; }
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(view);
  window.addEventListener('resize', resize);
  resize();

  $('hint').textContent = 'Drag to turn the sheet. Pinch or scroll to zoom.';
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    circuit.tick(Math.min(clock.getDelta(), 0.05));
    camera.position.set(cam.r * Math.sin(cam.phi) * Math.sin(cam.theta), cam.r * Math.cos(cam.phi), cam.r * Math.sin(cam.phi) * Math.cos(cam.theta));
    camera.lookAt(0, 0, 0.2);
    renderer.render(scene, camera);
  });
}

// ---------------------------------------------------------------------------
// AR view (camera + MindAR image tracking)
// ---------------------------------------------------------------------------
async function startAR() {
  const { MindARThree } = await import('mindar-image-three');
  const mindar = new MindARThree({
    container: $('view'),
    imageTargetSrc: 'targets.mind',
    filterMinCF: 0.0001,  // lower = less jitter
    filterBeta: 0.001,    // higher = less lag
    uiScanning: 'yes',
    uiLoading: 'yes'
  });
  const { renderer, scene, camera } = mindar;
  addLights(scene);

  // MindAR's anchor puts the worksheet in the x-y plane, 1 unit wide, facing the camera.
  // Turn our layout (paper on x-z, y up) to match and shrink it to that size.
  const holder = new THREE.Group();
  holder.rotation.x = Math.PI / 2;
  holder.scale.setScalar(1 / PW);
  holder.add(circuit.root);
  const anchor = mindar.addAnchor(0);
  anchor.group.add(holder);

  const hint = $('hint');
  hint.textContent = 'Point the camera at the whole worksheet.';
  anchor.onTargetFound = () => { hint.textContent = ''; };
  anchor.onTargetLost = () => { hint.textContent = 'Point the camera at the whole worksheet.'; };

  await mindar.start();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    circuit.tick(Math.min(clock.getDelta(), 0.05));
    renderer.render(scene, camera);
  });
}

// ---------------------------------------------------------------------------
// Start screen
// ---------------------------------------------------------------------------
circuit = buildCircuit();
bindControls();

function showError(text) {
  const m = $('startMsg'); m.textContent = text; m.hidden = false;
  $('start').hidden = false;
}

let arFailed = false;
$('start3D').addEventListener('click', () => {
  if (arFailed) { location.href = location.pathname + '?mode=3d'; return; } // start fresh after a camera error
  $('start').hidden = true;
  start3D();
});
if (new URLSearchParams(location.search).get('mode') === '3d') { $('start').hidden = true; start3D(); }

$('startAR').addEventListener('click', async () => {
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError('The camera only works when this page is opened over https, for example from GitHub Pages. Use the 3D view for now.');
    return;
  }
  $('start').hidden = true;
  try {
    await startAR();
  } catch (err) {
    console.error(err);
    arFailed = true;
    showError('The camera could not start. Check that this browser is allowed to use the camera, or use the 3D view instead.');
  }
});
