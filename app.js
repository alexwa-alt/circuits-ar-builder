import * as THREE from 'three';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------------------
// The kit. Order must match sheets/sheet-N.png and the targets in targets.mind.
// ---------------------------------------------------------------------------
const KIT = [
  { id: 'cell',      name: 'Cell',              type: 'cell' },
  { id: 'switch',    name: 'Switch',            type: 'switch' },
  { id: 'bulbA',     name: 'Bulb A',            type: 'bulb' },
  { id: 'bulbB',     name: 'Bulb B',            type: 'bulb' },
  { id: 'bulbC',     name: 'Bulb C',            type: 'bulb' },
  { id: 'resistor',  name: 'Resistor',          type: 'resistor' },
  { id: 'varres',    name: 'Variable resistor', type: 'varres' },
  { id: 'ammeter',   name: 'Ammeter',           type: 'ammeter' },
  { id: 'voltmeter', name: 'Voltmeter',         type: 'voltmeter' }
];

// Units: one "board unit" = the width of a printed sheet (MindAR's target width).
// Each sheet is 1 x 0.707. Models are drawn in "design units" (sheet = 10 wide,
// x right, z towards the bottom of the sheet, y up) and scaled by 0.1.
const SHEET_H = 0.707;
const TERM_X = 4.7;              // terminal position on the sheet, design units
// Distances are in sheet widths, so they work the same whatever size the sheets are printed.
// Sheets laid corner to corner put their dots about 0.65 apart, so the join distance
// has to be comfortably bigger than that.
const AUTO_JOIN = 1.0;           // dots closer than this connect automatically
const AUTO_KEEP = 1.3;           // ...and stay connected until further apart than this
const NEAR_MISS = 1.8;           // closer than this (but not joined): show a hint
const R_WIRE = 1e-3;

const state = { V: 6, Rb: 6, Rr: 10, Rv: 10, closed: true, mode: 'electron', mode3D: false, locked: false };

// ---------------------------------------------------------------------------
// Circuit solver (modified nodal analysis)
// ---------------------------------------------------------------------------
function gauss(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-30) continue;
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = Math.abs(A[r][r]) < 1e-30 ? 0 : s / A[r][r];
  }
  return x;
}
function solveMNA(nNodes, elements) {
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
  return [0, ...gauss(A, z).slice(0, n)];
}

// ---------------------------------------------------------------------------
// Materials and helpers
// ---------------------------------------------------------------------------
function canvasTexture(canvas) { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; return t; }
const MAT = {
  copper: new THREE.MeshStandardMaterial({ color: 0xB8743A, metalness: 0.6, roughness: 0.35 }),
  brass:  new THREE.MeshStandardMaterial({ color: 0xC9A24A, metalness: 0.7, roughness: 0.3 }),
  steel:  new THREE.MeshStandardMaterial({ color: 0xB9BEC4, metalness: 0.8, roughness: 0.3 }),
  dark:   new THREE.MeshStandardMaterial({ color: 0x34414F, roughness: 0.6 }),
  ink:    new THREE.MeshStandardMaterial({ color: 0x1D2B3A, roughness: 0.5 }),
  red:    new THREE.MeshStandardMaterial({ color: 0xE0484E, roughness: 0.5 }),
  lead:   new THREE.MeshStandardMaterial({ color: 0x7A5CC7, roughness: 0.5 })
};
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };

const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,225,150,1)'); grd.addColorStop(0.35, 'rgba(255,200,110,0.45)'); grd.addColorStop(1, 'rgba(255,190,90,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128); return canvasTexture(c);
})();

function sheetWire(root, x1, x2) {
  const len = x2 - x1;
  const m = mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 8), MAT.copper, (x1 + x2) / 2, 0.07, 0);
  m.rotation.z = Math.PI / 2; root.add(m);
}

// ---------------------------------------------------------------------------
// Component models (design units)
// ---------------------------------------------------------------------------
function buildModel(type) {
  const root = new THREE.Group();
  const api = { root, update() {}, setBright() {}, setReading() {} };

  if (type === 'cell') {
    sheetWire(root, -TERM_X, TERM_X);
    const g = new THREE.Group(); g.rotation.y = -Math.PI / 2; g.scale.setScalar(2);
    const along = m => { m.rotation.x = Math.PI / 2; return m; };
    g.add(along(mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.2, 32), MAT.ink, 0, 0.32, 0)));
    g.add(along(mesh(new THREE.CylinderGeometry(0.305, 0.305, 0.3, 32), MAT.brass, 0, 0.32, -0.45)));
    g.add(along(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.14, 20), MAT.steel, 0, 0.32, -0.66)));
    g.add(along(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 24), MAT.steel, 0, 0.32, 0.61)));
    root.add(g);
  }

  if (type === 'switch') {
    sheetWire(root, -TERM_X, -0.8); sheetWire(root, 0.8, TERM_X);
    const g = new THREE.Group(); g.scale.setScalar(2);
    g.add(mesh(new THREE.BoxGeometry(1.2, 0.08, 0.45), new THREE.MeshStandardMaterial({ color: 0xC8CED6, roughness: 0.7 }), 0, 0.04, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 16), MAT.brass, -0.4, 0.19, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 16), MAT.brass, 0.4, 0.19, 0));
    const lever = new THREE.Group(); lever.position.set(-0.4, 0.3, 0);
    lever.add(mesh(new THREE.BoxGeometry(0.84, 0.045, 0.1), MAT.brass, 0.42, 0, 0));
    lever.add(mesh(new THREE.SphereGeometry(0.07, 14, 10), MAT.red, 0.84, 0.05, 0));
    g.add(lever); root.add(g);
    api.update = dt => { lever.rotation.z += ((state.closed ? 0 : 0.6) - lever.rotation.z) * Math.min(1, dt * 10); };
  }

  if (type === 'bulb') {
    sheetWire(root, -TERM_X, TERM_X);
    const g = new THREE.Group(); g.scale.setScalar(2.6);
    g.add(mesh(new THREE.BoxGeometry(0.7, 0.22, 0.7), MAT.dark, 0, 0.11, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.26, 24), MAT.steel, 0, 0.35, 0));
    const fil = mesh(new THREE.TorusGeometry(0.09, 0.016, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0x553322, emissive: 0xFFB347, emissiveIntensity: 0.1 }), 0, 0.76, 0);
    g.add(fil);
    for (const dx of [-0.08, 0.08]) g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), MAT.steel, dx, 0.6, 0));
    const glass = mesh(new THREE.SphereGeometry(0.38, 32, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, roughness: 0.1, emissive: 0xFFD27A, emissiveIntensity: 0 }), 0, 0.78, 0);
    g.add(glass);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    glow.position.set(0, 0.78, 0); g.add(glow);
    root.add(g);
    api.setBright = b => {
      fil.material.emissiveIntensity = 0.1 + b * 2.5;
      glass.material.emissiveIntensity = b * 0.9;
      glow.material.opacity = b;
      glow.scale.setScalar(0.3 + b * 2.4);
    };
  }

  if (type === 'resistor') {
    sheetWire(root, -TERM_X, TERM_X);
    const body = mesh(new THREE.CylinderGeometry(0.36, 0.36, 2.2, 28), new THREE.MeshStandardMaterial({ color: 0xD9C8A0, roughness: 0.6 }), 0, 0.44, 0);
    body.rotation.z = Math.PI / 2; root.add(body);
    [[-0.65, 0x7A4A2A], [-0.35, 0x1D2B3A], [-0.05, 0xD8433E], [0.55, 0xC9A24A]].forEach(([x, c]) => {
      const band = mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.14, 28), new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }), x, 0.44, 0);
      band.rotation.z = Math.PI / 2; root.add(band);
    });
  }

  if (type === 'varres') {
    sheetWire(root, -TERM_X, TERM_X);
    const rc = document.createElement('canvas'); rc.width = 256; rc.height = 16;
    const rg = rc.getContext('2d');
    rg.fillStyle = '#D8C9A6'; rg.fillRect(0, 0, 256, 16);
    rg.fillStyle = '#A8662F'; for (let i = 0; i < 256; i += 8) rg.fillRect(i, 0, 4, 16);
    const g = new THREE.Group(); g.scale.setScalar(1.6);
    g.add(mesh(new THREE.BoxGeometry(1.5, 0.32, 0.42), new THREE.MeshStandardMaterial({ map: canvasTexture(rc), roughness: 0.6 }), 0, 0.16, 0));
    g.add(mesh(new THREE.BoxGeometry(1.5, 0.04, 0.06), MAT.steel, 0, 0.42, 0));
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.46, 0.5), MAT.dark, -0.8, 0.23, 0));
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.46, 0.5), MAT.dark, 0.8, 0.23, 0));
    const slider = mesh(new THREE.BoxGeometry(0.16, 0.16, 0.5), MAT.ink, 0, 0.42, 0);
    g.add(slider); root.add(g);
    api.update = dt => { slider.position.x += ((-0.6 + 1.2 * (state.Rv / 30)) - slider.position.x) * Math.min(1, dt * 10); };
  }

  if (type === 'ammeter' || type === 'voltmeter') {
    sheetWire(root, -TERM_X, TERM_X);
    root.add(mesh(new THREE.BoxGeometry(2.2, 0.55, 1.6), MAT.dark, 0, 0.275, 0));
    const c = document.createElement('canvas'); c.width = 512; c.height = 224;
    const g = c.getContext('2d');
    const tex = canvasTexture(c);
    const screen = mesh(new THREE.PlaneGeometry(1.9, 0.83), new THREE.MeshBasicMaterial({ map: tex }), 0, 0.62, 0.05);
    screen.rotation.x = -1.07;  // faces up, tilted towards the bottom of the sheet
    root.add(screen);
    let last = '';
    api.setReading = text => {
      if (text === last) return; last = text;
      g.fillStyle = '#CFE0C8'; g.fillRect(0, 0, 512, 224);
      g.fillStyle = '#1D2B3A'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 120px "Atkinson Hyperlegible", system-ui, sans-serif';
      g.fillText(text, 256, 118);
      tex.needsUpdate = true;
    };
    api.setReading(type === 'ammeter' ? '0.00 A' : '0.00 V');
  }

  // Terminal posts
  for (const sx of [-1, 1]) root.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 16), MAT.brass, sx * TERM_X, 0.15, 0));
  return api;
}

// ---------------------------------------------------------------------------
// Sheets on the board
// ---------------------------------------------------------------------------
const board = new THREE.Group();
const sheets = new Map();     // id -> sheet
const RING_GEO = new THREE.TorusGeometry(0.34, 0.08, 8, 28);
const HIT_GEO = new THREE.SphereGeometry(0.75, 10, 8);
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });
const hitTargets = [];        // terminal hit spheres (for tapping)
const sheetPlanes = [];       // paper planes (3D mode only, for dragging)

KIT.forEach((def, idx) => {
  const group = new THREE.Group();
  const design = new THREE.Group();
  design.rotation.x = Math.PI / 2; design.scale.setScalar(0.1);
  group.add(design);
  const model = buildModel(def.type);
  design.add(model.root);
  const rings = [], keys = [];
  [-1, 1].forEach((sx, t) => {
    const key = def.id + ':' + t;
    const ring = mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: 0xE0A43A }), sx * TERM_X, 0.32, 0);
    ring.rotation.x = Math.PI / 2;
    design.add(ring); rings.push(ring);
    const hit = mesh(HIT_GEO, HIT_MAT, sx * TERM_X, 0.3, 0);
    hit.userData.terminal = key;
    design.add(hit); hitTargets.push(hit);
    keys.push(key);
  });
  group.visible = false;
  board.add(group);
  sheets.set(def.id, { def, idx, group, model, rings, keys, present: false, pose: { x: 0, y: 0, a: 0 } });
});

function placeSheet(s) {
  s.group.position.set(s.pose.x, s.pose.y, 0);
  s.group.rotation.z = s.pose.a;
}
function terminalPos(key) {
  const [id, t] = key.split(':');
  const s = sheets.get(id);
  const lx = (t === '1' ? 1 : -1) * TERM_X / 10;
  return [s.pose.x + Math.cos(s.pose.a) * lx, s.pose.y + Math.sin(s.pose.a) * lx];
}
const presentSheets = () => [...sheets.values()].filter(s => s.present);

// ---------------------------------------------------------------------------
// Wires: automatic (dots close together) and added by tapping
// ---------------------------------------------------------------------------
let manualWires = [];   // {a, b}
let autoWires = [];
let nearMiss = null;    // closest pair of loose dots, for the hint
let selected = null;
const wireKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const sheetOf = key => key.split(':')[0];

function updateAutoWires() {
  const keys = presentSheets().flatMap(s => s.keys);
  const pos = Object.fromEntries(keys.map(k => [k, terminalPos(k)]));
  const dist = (a, b) => Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]);
  if (state.locked) { autoWires = autoWires.filter(w => pos[w.a] && pos[w.b]); nearMiss = null; return; }
  const keep = autoWires.filter(w => pos[w.a] && pos[w.b] && dist(w.a, w.b) < AUTO_KEEP);
  const used = new Set(keep.flatMap(w => [w.a, w.b]));
  const cands = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = keys[i], b = keys[j];
    if (sheetOf(a) === sheetOf(b) || used.has(a) || used.has(b)) continue;
    const d = dist(a, b);
    if (d < AUTO_JOIN) cands.push({ a, b, d });
  }
  cands.sort((p, q) => p.d - q.d);
  for (const c of cands) {
    if (used.has(c.a) || used.has(c.b)) continue;
    keep.push({ a: c.a, b: c.b }); used.add(c.a); used.add(c.b);
  }
  autoWires = keep;
  // Closest pair of dots that are still loose (not joined by any wire)
  const linked = new Set([...used, ...manualWires.flatMap(w => [w.a, w.b])]);
  nearMiss = null;
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = keys[i], b = keys[j];
    if (sheetOf(a) === sheetOf(b) || linked.has(a) || linked.has(b)) continue;
    const d = dist(a, b);
    if (d < NEAR_MISS && (!nearMiss || d < nearMiss.d)) nearMiss = { a, b, d };
  }
}
function allWires() {
  const ok = k => sheets.get(sheetOf(k)).present;
  return [
    ...autoWires.map(w => ({ ...w, kind: 'auto' })),
    ...manualWires.filter(w => ok(w.a) && ok(w.b)).map(w => ({ ...w, kind: 'manual' }))
  ];
}

function tapTerminal(key) {
  if (!selected) { selected = key; return; }
  if (selected === key) { selected = null; return; }
  const k = wireKey(selected, key);
  const i = manualWires.findIndex(w => wireKey(w.a, w.b) === k);
  if (i >= 0) manualWires.splice(i, 1); else manualWires.push({ a: selected, b: key });
  selected = null;
}

// ---------------------------------------------------------------------------
// Solving the circuit
// ---------------------------------------------------------------------------
let result = { elemI: {}, elemV: {}, wireI: {}, cellI: 0, short: false, hasCell: false };
let lastSig = '';

function solveCircuit() {
  const wires = allWires();
  const sig = JSON.stringify([presentSheets().map(s => s.def.id), wires.map(w => wireKey(w.a, w.b)).sort(), state.V, state.Rb, state.Rr, state.Rv, state.closed]);
  if (sig === lastSig) return;
  lastSig = sig;

  let n = 1; const node = {};
  const present = presentSheets();
  present.forEach(s => s.keys.forEach(k => { node[k] = n++; }));
  const els = [];
  const elemR = {};
  let cellInt = 0;
  for (const s of present) {
    const a = node[s.keys[0]], b = node[s.keys[1]];
    let r;
    switch (s.def.type) {
      case 'cell':
        cellInt = n++;
        els.push({ type: 'V', a: b, b: cellInt, v: state.V });        // terminal 1 is +
        els.push({ type: 'R', a: cellInt, b: a, r: 0.02 });           // small internal resistance
        continue;
      case 'switch': r = state.closed ? 1e-3 : 1e9; break;
      case 'bulb': r = state.Rb; break;
      case 'resistor': r = state.Rr; break;
      case 'varres': r = Math.max(state.Rv, 1e-3); break;
      case 'ammeter': r = 1e-3; break;
      case 'voltmeter': r = 1e7; break;
    }
    elemR[s.def.id] = r;
    els.push({ type: 'R', a, b, r });
  }
  for (const w of wires) els.push({ type: 'R', a: node[w.a], b: node[w.b], r: R_WIRE });
  for (let i = 1; i < n; i++) els.push({ type: 'R', a: i, b: 0, r: 1e9 });   // keeps loose parts solvable

  const V = solveMNA(n, els);
  const r = { elemI: {}, elemV: {}, wireI: {}, cellI: 0, short: false, hasCell: false };
  for (const s of present) {
    const a = node[s.keys[0]], b = node[s.keys[1]];
    let I;
    if (s.def.type === 'cell') I = (V[a] - V[cellInt]) / 0.02;
    else I = (V[a] - V[b]) / elemR[s.def.id];
    if (Math.abs(I) < 1e-6) I = 0;
    if (s.def.type === 'cell') { r.cellI = I; r.hasCell = true; }
    r.elemI[s.def.id] = I;            // current from terminal 0 to terminal 1
    r.elemV[s.def.id] = V[a] - V[b];  // voltage of terminal 0 relative to terminal 1
  }
  for (const w of wires) {
    let I = (V[node[w.a]] - V[node[w.b]]) / R_WIRE;
    if (Math.abs(I) < 1e-6) I = 0;
    r.wireI[wireKey(w.a, w.b) + w.kind] = { I, a: w.a };
  }
  r.short = Math.abs(r.cellI) > 10;
  result = r;
  applyResults();
}

const fmt = (x, unit) => {
  if (Math.abs(x) < 0.005) x = 0;
  return (Math.abs(x) > 0 && Math.abs(x) < 0.01 ? x.toFixed(3) : x.toFixed(2)) + ' ' + unit;
};

function applyResults() {
  const rows = [];
  for (const s of presentSheets()) {
    const id = s.def.id, I = result.elemI[id] || 0, Vd = result.elemV[id] || 0;
    if (s.def.type === 'bulb') s.model.setBright(1 - Math.exp(-(I * I * state.Rb) / 1.5));
    if (s.def.type === 'ammeter') s.model.setReading(fmt(-I, 'A'));      // + terminal is terminal 1
    if (s.def.type === 'voltmeter') s.model.setReading(fmt(-Vd, 'V'));   // reads V(+) - V(-)
    rows.push(`<tr><td>${s.def.name}</td><td>${fmt(Math.abs(Vd), 'V')}</td><td>${fmt(Math.abs(I), 'A')}</td></tr>`);
  }
  $('valsBody').innerHTML = rows.length
    ? '<tr><td></td><td>Voltage</td><td>Current</td></tr>' + rows.join('')
    : '<tr><td>No sheets yet.</td><td></td><td></td></tr>';
}

// ---------------------------------------------------------------------------
// Wire meshes and moving charges (board space)
// ---------------------------------------------------------------------------
const WIRE_GEO = new THREE.CylinderGeometry(0.006, 0.006, 1, 8);
const wirePool = [];
const nearLine = new THREE.Mesh(WIRE_GEO, new THREE.MeshBasicMaterial({ color: 0xE0A43A, transparent: true, opacity: 0.6 }));
nearLine.visible = false;
board.add(nearLine);
const UP = new THREE.Vector3(0, 1, 0);
function drawWires(wires) {
  wires.forEach((w, i) => {
    let m = wirePool[i];
    if (!m) { m = new THREE.Mesh(WIRE_GEO, MAT.copper); board.add(m); wirePool.push(m); }
    const p = terminalPos(w.a), q = terminalPos(w.b);
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1e-4;
    m.material = w.kind === 'manual' ? MAT.lead : MAT.copper;
    m.position.set((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, 0.012);
    m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx / len, dy / len, 0));
    m.scale.set(1, len, 1);
    m.visible = true;
  });
  for (let i = wires.length; i < wirePool.length; i++) wirePool[i].visible = false;
  if (nearMiss && result.hasCell && result.cellI === 0) {
    const p = terminalPos(nearMiss.a), q = terminalPos(nearMiss.b);
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1e-4;
    nearLine.position.set((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, 0.012);
    nearLine.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx / len, dy / len, 0));
    nearLine.scale.set(1, len, 1);
    nearLine.material.opacity = 0.35 + 0.35 * Math.sin(performance.now() / 200);
    nearLine.visible = true;
  } else nearLine.visible = false;
}

const MAX_DOTS = 1200, SPACING = 0.04;
const dotMat = new THREE.MeshStandardMaterial({ color: 0x2F9BFF, emissive: 0x2F9BFF, emissiveIntensity: 0.6 });
const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0085, 10, 8), dotMat, MAX_DOTS);
dots.frustumCulled = false;
board.add(dots);
const phases = {};
const tmpM = new THREE.Matrix4();

function drawDots(dt, wires) {
  const segs = [];
  for (const s of presentSheets()) {
    segs.push({ key: s.def.id, p: terminalPos(s.keys[0]), q: terminalPos(s.keys[1]), I: result.elemI[s.def.id] || 0, z: 0.012 });
  }
  for (const w of wires) {
    const info = result.wireI[wireKey(w.a, w.b) + w.kind];
    let I = info ? info.I : 0;
    if (info && info.a !== w.a) I = -I;
    segs.push({ key: wireKey(w.a, w.b) + w.kind, p: terminalPos(w.a), q: terminalPos(w.b), I, z: 0.02 });
  }
  const dir = state.mode === 'electron' ? -1 : 1;
  let count = 0;
  for (const sg of segs) {
    const dx = sg.q[0] - sg.p[0], dy = sg.q[1] - sg.p[1], len = Math.hypot(dx, dy);
    if (len < 1e-3) continue;
    const v = clamp(sg.I * 0.25, -0.8, 0.8) * dir;
    phases[sg.key] = ((phases[sg.key] || 0) + v * dt) % 100;
    const nDots = Math.max(1, Math.round(len / SPACING)), step = len / nDots;
    const ph = ((phases[sg.key] % step) + step) % step;
    for (let k = 0; k < nDots && count < MAX_DOTS; k++) {
      const t = (k * step + ph) / len;
      tmpM.makeTranslation(sg.p[0] + dx * t, sg.p[1] + dy * t, sg.z);
      dots.setMatrixAt(count++, tmpM);
    }
  }
  dots.count = count;
  dots.instanceMatrix.needsUpdate = true;
}

function colourTerminals(wires) {
  const linked = new Set(wires.flatMap(w => [w.a, w.b]));
  for (const s of sheets.values()) s.rings.forEach((ring, t) => {
    const key = s.keys[t];
    ring.material.color.setHex(key === selected ? 0xFFFFFF : linked.has(key) ? 0x2BA84A : 0xE0A43A);
    ring.scale.setScalar(key === selected ? 1.5 : 1);
  });
}

// ---------------------------------------------------------------------------
// One frame of the circuit (both modes)
// ---------------------------------------------------------------------------
let hintOverride = '';
function frame(dt) {
  for (const s of sheets.values()) { s.group.visible = s.present; if (s.present) { placeSheet(s); s.model.update(dt); } }
  updateAutoWires();
  solveCircuit();
  const wires = allWires();
  drawWires(wires);
  drawDots(dt, wires);
  colourTerminals(wires);

  const hint = $('hint');
  let text = hintOverride, warn = false;
  if (!text) {
    const present = presentSheets();
    if (!present.length) text = state.mode3D ? 'Add sheets from the panel, or pick Series or Parallel.' : '';
    else if (selected) text = 'Now tap the dot to connect it to.';
    else if (result.short) { text = 'Short circuit! The cell is connected with almost nothing to limit the current.'; warn = true; }
    else if (!result.hasCell) text = 'Add the cell to power the circuit.';
    else if (result.cellI === 0 && nearMiss) {
      const nm = k => sheets.get(sheetOf(k)).def.name;
      text = `Not complete yet: move the ${nm(nearMiss.a)} and ${nm(nearMiss.b)} dots closer, or tap both to add a wire.`;
    }
    else if (result.cellI === 0) text = state.closed ? 'No complete circuit yet. Tap one dot, then another, to add a wire.' : 'The switch is open, so no current flows.';
    else text = '';
  }
  if (hint.textContent !== text) hint.textContent = text;
  hint.classList.toggle('warn', warn);
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 8, 4); scene.add(sun);
}

// Tap detection shared by both modes
const raycaster = new THREE.Raycaster();
function pickTerminal(clientX, clientY, camera, rectEl) {
  const r = rectEl.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const live = hitTargets.filter(h => sheets.get(sheetOf(h.userData.terminal)).present);
  const hit = raycaster.intersectObjects(live, false)[0];
  return hit ? hit.object.userData.terminal : null;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
function setMode(mode) {
  state.mode = mode;
  $('mElectron').setAttribute('aria-pressed', mode === 'electron');
  $('mConv').setAttribute('aria-pressed', mode === 'conv');
  const col = mode === 'electron' ? 0x2F9BFF : 0xE0484E;
  dotMat.color.setHex(col); dotMat.emissive.setHex(col);
  $('legend').innerHTML = mode === 'electron'
    ? '<span class="dot" style="background:var(--electron)"></span>Blue dots are electrons. They drift out of the negative terminal, round the circuit, and back into the positive terminal.'
    : '<span class="dot" style="background:var(--conv)"></span>Red dots show conventional current: the direction positive charge would flow, from + round to \u2212. It is the opposite way to the electrons.';
}

let chipClick = () => {};
function renderChips() {
  $('chips').innerHTML = '';
  for (const s of sheets.values()) {
    const b = document.createElement('button');
    b.textContent = s.def.name;
    b.setAttribute('aria-pressed', s.present);
    if (!state.mode3D && !s.present) b.disabled = true;
    b.addEventListener('click', () => chipClick(s));
    $('chips').appendChild(b);
  }
}

function removeSheet(s) {
  s.present = false;
  manualWires = manualWires.filter(w => sheetOf(w.a) !== s.def.id && sheetOf(w.b) !== s.def.id);
  if (selected && sheetOf(selected) === s.def.id) selected = null;
}

function bindControls() {
  const bindRange = (id, key, unit) => {
    const el = $(id), out = $(id + 'Out');
    const update = () => { state[key] = parseFloat(el.value); out.textContent = state[key] + ' ' + unit; };
    el.addEventListener('input', update); update();
  };
  bindRange('volt', 'V', 'V');
  bindRange('rb', 'Rb', '\u03A9');
  bindRange('rr', 'Rr', '\u03A9');
  bindRange('rv', 'Rv', '\u03A9');
  $('sw').addEventListener('click', () => {
    state.closed = !state.closed;
    $('sw').textContent = state.closed ? 'Open the switch' : 'Close the switch';
  });
  $('mElectron').addEventListener('click', () => setMode('electron'));
  $('mConv').addEventListener('click', () => setMode('conv'));
  $('toggleVals').addEventListener('click', () => {
    const t = $('vals'); t.hidden = !t.hidden;
    $('toggleVals').textContent = t.hidden ? 'Show readings' : 'Hide readings';
  });
  $('clearWires').addEventListener('click', () => { manualWires = []; selected = null; });
  $('lock').addEventListener('click', () => {
    state.locked = !state.locked;
    $('lock').setAttribute('aria-pressed', state.locked);
    $('lock').textContent = state.locked ? 'Connections locked' : 'Lock connections';
  });
  $('collapse').addEventListener('click', () => {
    const p = $('panel'); p.classList.toggle('collapsed');
    const open = !p.classList.contains('collapsed');
    $('collapse').textContent = open ? 'Hide controls' : 'Show controls';
    $('collapse').setAttribute('aria-expanded', open);
    window.dispatchEvent(new Event('resize'));
  });
  $('back').addEventListener('click', () => { location.href = location.pathname; });
  setMode('electron');
  $('howto').textContent = 'Lay the sheets out like a circuit diagram. Dots that are close together join up by themselves. To add a wire, tap one dot and then another; tap the same pair again to remove it.';
}

// ---------------------------------------------------------------------------
// 3D view (no camera): sheets on a virtual table
// ---------------------------------------------------------------------------
const PRESETS = {
  series: {
    sheets: { cell: [-0.95, 0, 90], switch: [0, 0.75, 0], bulbA: [0.95, 0, -90], bulbB: [0, -0.75, 180], voltmeter: [1.85, 0, 90] },
    wires: [['voltmeter:1', 'bulbA:0'], ['voltmeter:0', 'bulbA:1']]
  },
  parallel: {
    sheets: { cell: [-1.3, 0.4, 90], bulbA: [0, 0.8, 0], bulbB: [0, 0, 0], ammeter: [0, -0.8, 0] },
    wires: [['cell:1', 'bulbA:0'], ['bulbA:0', 'bulbB:0'], ['bulbA:1', 'bulbB:1'], ['bulbB:1', 'ammeter:1'], ['ammeter:0', 'cell:0']]
  }
};
function unlock() {
  state.locked = false;
  $('lock').setAttribute('aria-pressed', 'false'); $('lock').textContent = 'Lock connections';
}
function loadPreset(p) {
  unlock();
  for (const s of sheets.values()) s.present = false;
  manualWires = []; autoWires = []; selected = null;
  if (p) {
    for (const [id, [x, y, deg]] of Object.entries(p.sheets)) {
      const s = sheets.get(id); s.present = true; s.pose = { x, y, a: deg * Math.PI / 180 };
    }
    manualWires = p.wires.map(([a, b]) => ({ a, b }));
  }
  renderChips();
}
function freeSpot() {
  for (let ring = 0; ring < 6; ring++) for (let i = 0; i < 8; i++) {
    const x = -1.2 + (i % 4) * 0.8 + ring * 0.1, y = -1.7 - Math.floor(i / 4) * 0.8 - ring * 0.1;
    if (presentSheets().every(s => Math.hypot(s.pose.x - x, s.pose.y - y) > 0.75)) return { x, y };
  }
  return { x: 0, y: -1.7 };
}

function start3D() {
  state.mode3D = true;
  $('presets').hidden = false;
  $('chipsNote').textContent = 'Tap a name to put that sheet on the table or take it off. Drag a sheet to move it, and tap it to turn it.';
  chipClick = s => {
    if (s.present) removeSheet(s);
    else { const p = freeSpot(); s.pose = { x: p.x, y: p.y, a: 0 }; s.present = true; }
    renderChips();
  };
  $('pSeries').onclick = () => loadPreset(PRESETS.series);
  $('pParallel').onclick = () => loadPreset(PRESETS.parallel);
  $('pClear').onclick = () => loadPreset(null);

  const view = $('view');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  view.insertBefore(renderer.domElement, view.firstChild);
  const el = renderer.domElement;
  el.style.width = '100%'; el.style.height = '100%';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2C3A47');
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  addLights(scene);
  board.rotation.x = -Math.PI / 2;   // board z (up) becomes world y
  scene.add(board);

  // Paper for each sheet
  const loader = new THREE.TextureLoader();
  for (const s of sheets.values()) {
    const tex = loader.load(`sheets/sheet-${s.idx}.png`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, SHEET_H), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    plane.userData.sheet = s.def.id;
    s.group.add(plane); sheetPlanes.push(plane);
  }

  // Camera orbit + sheet dragging
  const cam = { theta: 0, phi: 0.75, r: 4.2 };
  const target = new THREE.Vector3();
  const pts = new Map(); let pinch = null, action = null;
  const tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const toBoard = (cx, cy) => {
    const r = el.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
    const p = new THREE.Vector3();
    return raycaster.ray.intersectPlane(tablePlane, p) ? [p.x, -p.z] : null;
  };
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size > 1) { action = null; return; }
    const term = pickTerminal(e.clientX, e.clientY, camera, el);
    if (term) { action = { kind: 'terminal', term, x: e.clientX, y: e.clientY }; return; }
    const r = el.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = raycaster.intersectObjects(sheetPlanes.filter(p => sheets.get(p.userData.sheet).present), false)[0];
    if (hit) {
      const s = sheets.get(hit.object.userData.sheet);
      action = { kind: 'sheet', s, start: toBoard(e.clientX, e.clientY), pose: { ...s.pose }, x: e.clientX, y: e.clientY, moved: false };
    } else action = { kind: 'orbit' };
  });
  el.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) cam.r = clamp(cam.r * pinch / d, 1.2, 9);
      pinch = d; return;
    }
    if (!action) return;
    if (action.kind === 'orbit') {
      cam.theta -= (e.clientX - prev[0]) * 0.008;
      cam.phi = clamp(cam.phi - (e.clientY - prev[1]) * 0.006, 0.12, 1.35);
    } else if (action.kind === 'sheet') {
      if (Math.hypot(e.clientX - action.x, e.clientY - action.y) > 6) action.moved = true;
      const p = toBoard(e.clientX, e.clientY);
      if (action.moved && p && action.start) {
        action.s.pose.x = action.pose.x + p[0] - action.start[0];
        action.s.pose.y = action.pose.y + p[1] - action.start[1];
      }
    }
  });
  const release = e => {
    pts.delete(e.pointerId); pinch = null;
    if (action && action.kind === 'terminal' && Math.hypot(e.clientX - action.x, e.clientY - action.y) < 10) tapTerminal(action.term);
    if (action && action.kind === 'sheet' && !action.moved) action.s.pose.a += Math.PI / 2;
    action = null;
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', e => { pts.delete(e.pointerId); pinch = null; action = null; });
  el.addEventListener('wheel', e => { e.preventDefault(); cam.r = clamp(cam.r * (1 + e.deltaY * 0.001), 1.2, 9); }, { passive: false });

  let fitted = false;
  function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (!fitted) { const a = w / h; cam.r = a >= 1.4 ? 4.2 : clamp(4.2 * 1.4 / a * 0.9, 4.2, 9); fitted = true; }
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(view);
  window.addEventListener('resize', resize);
  resize();

  loadPreset(PRESETS.series);
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    frame(Math.min(clock.getDelta(), 0.05));
    camera.position.set(cam.r * Math.sin(cam.phi) * Math.sin(cam.theta), cam.r * Math.cos(cam.phi), cam.r * Math.sin(cam.phi) * Math.cos(cam.theta));
    const ps = presentSheets();
    if (ps.length) {
      const cx = ps.reduce((t, s) => t + s.pose.x, 0) / ps.length, cy = ps.reduce((t, s) => t + s.pose.y, 0) / ps.length;
      if (!action || action.kind !== 'sheet') { target.x += (cx - target.x) * 0.05; target.z += (-cy - target.z) * 0.05; }
    }
    camera.position.add(target);
    camera.lookAt(target);
    renderer.render(scene, camera);
  });
}

// ---------------------------------------------------------------------------
// AR view: track every sheet, remember where each one sits relative to the others
// ---------------------------------------------------------------------------
async function startAR() {
  // MindAR asks for the camera without a resolution, which often gives a small 640x480
  // feed. Ask for 1280x720 so sheets further from the camera can still be recognised.
  const md = navigator.mediaDevices, origGUM = md.getUserMedia.bind(md);
  md.getUserMedia = c => {
    if (c && c.video && typeof c.video === 'object') { c.video.width = { ideal: 1280 }; c.video.height = { ideal: 720 }; }
    return origGUM(c);
  };
  const { MindARThree } = await import('mindar-image-three');
  const mindar = new MindARThree({
    container: $('view'),
    imageTargetSrc: 'targets.mind',
    maxTrack: 6,
    filterMinCF: 0.0001,
    filterBeta: 0.001,
    uiScanning: 'no',
    uiLoading: 'yes'
  });
  const { renderer, scene, camera } = mindar;
  addLights(scene);
  board.matrixAutoUpdate = false;
  scene.add(board);
  const anchors = KIT.map((def, i) => mindar.addAnchor(i));

  state.mode3D = false;
  $('forget').hidden = false;
  $('chipsNote').textContent = 'Sheets light up here once the camera has seen them. Tap a name to forget that sheet.';
  chipClick = s => { if (s.present) { removeSheet(s); renderChips(); } };
  $('forget').onclick = () => {
    unlock();
    for (const s of sheets.values()) s.present = false;
    manualWires = []; autoWires = []; selected = null; renderChips();
  };
  renderChips();

  // Taps on the camera view
  const view = $('view');
  let down = null;
  view.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  view.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 12) return;
    board.updateMatrixWorld(true);
    const term = pickTerminal(e.clientX, e.clientY, camera, renderer.domElement);
    if (term) tapTerminal(term);
  });

  // Board pose maths
  const sheetMatrix = p => new THREE.Matrix4().makeRotationZ(p.a).setPosition(p.x, p.y, 0);
  const boardM = new THREE.Matrix4();
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();
  let boardKnown = false;

  function updatePoses() {
    const visible = sheetsArr.filter(s => anchors[s.idx].visible);
    const known = visible.filter(s => s.present);

    if (!presentSheets().length && visible.length) {
      // first sheet seen becomes the origin of the board
      const s = visible[0]; s.present = true; s.pose = { x: 0, y: 0, a: 0 }; renderChips();
      known.push(s);
    }
    if (!known.length) {
      board.visible = false;
      hintOverride = !visible.length
        ? (presentSheets().length ? 'Point the camera at the sheets.' : 'Point the camera at one of the sheets.')
        : 'Keep a sheet that has already been found in view, so the new one can be placed next to it.';
      return;
    }
    hintOverride = '';

    // Estimate where the board is from every visible sheet we already know
    let n = 0;
    pos.set(0, 0, 0);
    for (const s of known) {
      const est = anchors[s.idx].group.matrix.clone().multiply(sheetMatrix(s.pose).invert());
      est.decompose(tmpP, tmpQ, tmpS);
      if (n === 0) { quat.copy(tmpQ); scl.copy(tmpS); }
      else { if (quat.dot(tmpQ) < 0) tmpQ.set(-tmpQ.x, -tmpQ.y, -tmpQ.z, -tmpQ.w); quat.slerp(tmpQ, 1 / (n + 1)); }
      pos.add(tmpP); n++;
    }
    pos.divideScalar(n);
    boardM.compose(pos, quat, scl);
    board.matrix.copy(boardM);
    board.visible = true;
    boardKnown = true;

    // Measure each visible sheet's position on the board. Depth from a single small
    // target is unreliable, so cast a ray from the camera through the sheet's centre
    // (and through a point along its x axis) and see where it meets the table plane.
    const inv = boardM.clone().invert();
    const e = boardM.elements;
    const nB = new THREE.Vector3(e[8], e[9], e[10]).normalize();
    const oB = new THREE.Vector3(e[12], e[13], e[14]);
    const onBoard = p => {
      const d = nB.dot(p); if (Math.abs(d) < 1e-9) return null;
      const t = nB.dot(oB) / d; if (!(t > 0)) return null;
      return p.multiplyScalar(t).applyMatrix4(inv);
    };
    let changed = false;
    for (const s of visible) {
      const W = anchors[s.idx].group.matrix;
      const c = onBoard(new THREE.Vector3(0, 0, 0).applyMatrix4(W));
      const xe = onBoard(new THREE.Vector3(0.47, 0, 0).applyMatrix4(W));
      if (!c || !xe) continue;
      const m = { x: c.x, y: c.y, a: Math.atan2(xe.y - c.y, xe.x - c.x) };
      if (!s.present) { s.present = true; s.pose = m; changed = true; continue; }
      const k = 0.15;
      let da = m.a - s.pose.a; da = Math.atan2(Math.sin(da), Math.cos(da));
      s.pose.x += (m.x - s.pose.x) * k; s.pose.y += (m.y - s.pose.y) * k; s.pose.a += da * k;
    }
    if (changed) renderChips();
  }
  const sheetsArr = [...sheets.values()];

  await mindar.start();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    updatePoses();
    frame(Math.min(clock.getDelta(), 0.05));
    renderer.render(scene, camera);
  });
}

// ---------------------------------------------------------------------------
// Start screen
// ---------------------------------------------------------------------------
bindControls();
renderChips();
applyResults();

let arFailed = false;
function showError(text) { const m = $('startMsg'); m.textContent = text; m.hidden = false; $('start').hidden = false; }

$('start3D').addEventListener('click', () => {
  if (arFailed) { location.href = location.pathname + '?mode=3d'; return; }
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
  try { await startAR(); }
  catch (err) {
    console.error(err);
    arFailed = true;
    showError('The camera could not start. Check that this browser is allowed to use the camera, or use the 3D view instead.');
  }
});

