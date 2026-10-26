/* TCP Receiver Window Bottleneck Experiment - main script.
   Everything here is conceptual; the only real data are the RESULTS below,
   taken from my experiment. */
'use strict';

const RESULTS = {
  throughput: { small: 0.89, large: 17.27 },   // Mbps (measured)
  zeroWindow: { small: 37, large: 32 }          // events (measured)
};
const $ = id => document.getElementById(id);
const HAS_THREE = typeof THREE !== 'undefined';

/* ---------- Hero background: animated glowing network (2D canvas) ---------- */
(function heroBg() {
  const c = $('net-bg'), g = c.getContext('2d');
  let nodes = [], w, h;
  function size() {
    w = c.width = c.offsetWidth; h = c.height = c.offsetHeight;
    nodes = Array.from({ length: Math.round(w / 45) }, () =>
      ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .3, vy: (Math.random() - .5) * .3 }));
  }
  function draw() {
    g.clearRect(0, 0, w, h);
    nodes.forEach((a, i) => {
      a.x = (a.x + a.vx + w) % w; a.y = (a.y + a.vy + h) % h;
      g.fillStyle = '#4fd8ff'; g.beginPath(); g.arc(a.x, a.y, 2, 0, 7); g.fill();
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 140) { g.strokeStyle = `rgba(47,140,255,${.35 * (1 - d / 140)})`; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
      }
    });
    requestAnimationFrame(draw);
  }
  addEventListener('resize', size); size(); draw();
})();

/* ---------- Helpers ---------- */
function label(text, color = '#ffffff', scale = 1.6) {          // text sprite for 3D scenes
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const x = cv.getContext('2d'); x.font = 'bold 34px Segoe UI, sans-serif'; x.fillStyle = color;
  x.textAlign = 'center'; x.fillText(text, 128, 44);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
  s.scale.set(scale * 2, scale * .5, 1); return s;
}
function makeScene(el, camPos) {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2)); el.appendChild(r.domElement);
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(50, 1, .1, 100);
  cam.position.set(...camPos); cam.lookAt(0, 0, 0);
  sc.add(new THREE.AmbientLight(0x6688cc, .8));
  const p = new THREE.PointLight(0x4fd8ff, 1.4); p.position.set(4, 6, 6); sc.add(p);
  const fit = () => { r.setSize(el.clientWidth, el.clientHeight); cam.aspect = el.clientWidth / el.clientHeight; cam.updateProjectionMatrix(); };
  addEventListener('resize', fit); fit();
  return { r, sc, cam };
}
function fail(el, msg) { el.innerHTML = '<div class="fallback">' + msg + '</div>'; }

/* ---------- Simulation state (pure logic, drives both 3D and the HUD) ---------- */
const MODES = { small: { cap: 8, drain: 2, name: 'Small' }, large: { cap: 40, drain: 3, name: 'Large' } };
const SEND_RATE = 4;            // simulated segments per second
const S = { mode: 'small', fill: 0, paused: false, zw: 0, timer: 0, pk: [] };

function hud() {
  const m = MODES[S.mode], win = Math.max(0, Math.round(m.cap - S.fill));
  $('h-mode').textContent = m.name; $('h-cap').textContent = m.cap; $('h-win').textContent = win;
  $('h-bar').style.width = (S.fill / m.cap * 100) + '%';
  $('h-zw').textContent = S.zw;
  const st = $('h-state'); st.textContent = S.paused ? 'Paused (zero window)' : 'Sending'; st.className = S.paused ? 'bad' : 'ok';
  $('h-msg').textContent = S.paused
    ? 'PC2 advertised window = 0. PC1 stops sending until PC2 sends a window update.'
    : S.mode === 'small' ? 'The small buffer fills quickly, so the window closes often.'
    : 'The large buffer has more spare capacity, so the window stays open longer.';
}
function setMode(mode) {
  S.mode = mode; S.fill = 0; S.paused = false; S.zw = 0; S.timer = 0;
  S.pk.forEach(p => scene3d && scene3d.sc.remove(p.m)); S.pk = [];
  $('btn-small').classList.toggle('on', mode === 'small');
  $('btn-large').classList.toggle('on', mode === 'large');
  hud();
}
function step(dt) {
  const m = MODES[S.mode];
  if (!S.paused) {
    S.timer += dt;
    while (S.timer > 1 / SEND_RATE) { S.timer -= 1 / SEND_RATE; spawn(); }
  }
  S.fill = Math.max(0, S.fill - m.drain * dt);              // application reads data
  S.pk.forEach(p => { p.t += dt / 1.2; if (p.t >= 1) { S.fill = Math.min(m.cap, S.fill + 1); p.dead = true; } });
  S.pk = S.pk.filter(p => { if (p.dead && p.m && scene3d) scene3d.sc.remove(p.m); return !p.dead; });
  if (!S.paused && S.fill >= m.cap) { S.paused = true; S.zw++; }          // window closes
  else if (S.paused && S.fill <= m.cap * .5) S.paused = false;            // window update
  hud();
}
function spawn() { S.pk.push({ t: 0, m: null }); }

/* ---------- 3D simulation scene ---------- */
let scene3d = null, sender, bufBox, fillBox, bufFrame;
function initSim() {
  const el = $('sim3d');
  if (!HAS_THREE) return fail(el, 'The 3D library could not be loaded (check your internet connection). The simulation still runs: use the panel next to this box and the buttons above.');
  try {
    scene3d = makeScene(el, [0, 3.2, 11]);
    const sc = scene3d.sc;
    const pc = (x, name, col) => {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, .2, 1.4), new THREE.MeshStandardMaterial({ color: 0x1a3a7a }));
      const scr = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, .15), new THREE.MeshStandardMaterial({ color: 0x0a1d42, emissive: col, emissiveIntensity: .6 }));
      scr.position.set(0, .95, 0); g.add(base, scr);
      const t = label(name, '#ffffff'); t.position.set(0, 2.2, 0); g.add(t);
      g.position.set(x, -1.2, 0); sc.add(g); return scr;
    };
    sender = pc(-5, 'PC1 (Sender)', 0x2f8cff); pc(5, 'PC2 (Receiver)', 0x4fd8ff);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 8.6, 8), new THREE.MeshBasicMaterial({ color: 0x2f8cff }));
    cable.rotation.z = Math.PI / 2; cable.position.y = -.3; sc.add(cable);
    bufFrame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 1.2), new THREE.MeshBasicMaterial({ color: 0x4fd8ff, wireframe: true }));
    fillBox = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1, 1.1), new THREE.MeshStandardMaterial({ color: 0x2f8cff, transparent: true, opacity: .85 }));
    sc.add(bufFrame, fillBox);
    const bl = label('Receiver buffer', '#4fd8ff', 1.2); bl.position.set(5, 4.6, 0); sc.add(bl);
    bufBox = bl;
  } catch (e) { scene3d = null; fail(el, '3D rendering is not available in this browser. The HUD beside the box shows the same simulation.'); }
}
function render3d(now) {
  if (!scene3d) return;
  const m = MODES[S.mode], H = m.cap === 8 ? 1.5 : 3.6;     // large buffer is drawn taller
  bufFrame.scale.y = H; bufFrame.position.set(5, -1.2 + H / 2 + 1.7, 0);
  const f = Math.max(.001, S.fill / m.cap);
  fillBox.scale.y = H * f; fillBox.position.set(5, -1.2 + 1.7 + H * f / 2, 0);
  fillBox.material.color.setHex(f > .85 ? 0xff6b6b : 0x2f8cff);
  bufBox.position.y = 1.9 + H + .3;
  sender.material.emissive.setHex(S.paused ? 0xff4040 : 0x2f8cff);
  S.pk.forEach(p => {
    if (!p.m) { p.m = new THREE.Mesh(new THREE.SphereGeometry(.17, 12, 12), new THREE.MeshBasicMaterial({ color: 0x4fd8ff })); scene3d.sc.add(p.m); }
    p.m.position.set(-3.8 + 7.6 * p.t, -.3, 0);
  });
  scene3d.sc.rotation.y = Math.sin(now / 4000) * .12;
  scene3d.r.render(scene3d.sc, scene3d.cam);
}
let last = performance.now();
function loop(now) {
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  step(dt); render3d(now); requestAnimationFrame(loop);
}
$('btn-small').onclick = () => setMode('small');
$('btn-large').onclick = () => setMode('large');
$('btn-reset').onclick = () => setMode(S.mode);

/* ---------- 2D SVG bar charts ---------- */
function barChart(id, title, unit, a, b, fmt) {
  const W = 420, H = 300, max = Math.max(a, b) * 1.18, base = 250, top = 40;
  const bar = (x, v, col, name) => {
    const h = v / max * (base - top), y = base - h;
    return `<g class="bar"><title>${name}: ${fmt(v)} ${unit}</title><rect x="${x}" y="${y}" width="110" height="${h}" rx="5" fill="${col}"/>
      <text x="${x + 55}" y="${y - 8}" text-anchor="middle" font-weight="700">${fmt(v)}</text>
      <text x="${x + 55}" y="${base + 20}" text-anchor="middle" font-size="13">${name}</text></g>`;
  };
  $(id).innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}" width="100%">
    <text x="${W / 2}" y="20" text-anchor="middle" font-weight="700">${title}</text>
    <line x1="40" y1="${base}" x2="${W - 20}" y2="${base}" stroke="#2f8cff"/>
    <text x="12" y="${(base + top) / 2}" transform="rotate(-90 12 ${(base + top) / 2})" text-anchor="middle" font-size="12">${unit}</text>
    ${bar(80, a, '#2f8cff', 'Small buffer')}${bar(240, b, '#4fd8ff', 'Large buffer')}
    <rect x="90" y="${H - 22}" width="12" height="12" fill="#2f8cff"/><text x="108" y="${H - 12}" font-size="12">Small buffer</text>
    <rect x="220" y="${H - 22}" width="12" height="12" fill="#4fd8ff"/><text x="238" y="${H - 12}" font-size="12">Large buffer</text></svg>`;
}
barChart('chart-tp', 'Throughput', 'Mbps', RESULTS.throughput.small, RESULTS.throughput.large, v => v.toFixed(2));
barChart('chart-zw', 'Zero-window events', 'events', RESULTS.zeroWindow.small, RESULTS.zeroWindow.large, v => String(v));

/* ---------- 3D bar chart (drag to rotate) ---------- */
(function chart3D() {
  const el = $('chart3d');
  if (!HAS_THREE) return fail(el, '3D chart unavailable offline. The 2D charts above show the same data: 0.89 Mbps (small) and 17.27 Mbps (large).');
  try {
    const { r, sc, cam } = makeScene(el, [4, 4, 9]);
    const grp = new THREE.Group(); sc.add(grp);
    const add = (x, v, col, name) => {
      const h = v / 17.27 * 4;
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, h, 1.6), new THREE.MeshStandardMaterial({ color: col }));
      m.position.set(x, h / 2 - 2, 0); grp.add(m);
      const t = label(v.toFixed(2) + ' Mbps', '#ffffff', 1.3); t.position.set(x, h - 1.4, 0); grp.add(t);
      const n = label(name, '#8fa9d6', 1.3); n.position.set(x, -2.6, 1.6); grp.add(n);
    };
    add(-2, RESULTS.throughput.small, 0x2f8cff, 'Small buffer'); add(2, RESULTS.throughput.large, 0x4fd8ff, 'Large buffer');
    const floor = new THREE.GridHelper(9, 9, 0x2f8cff, 0x14305f); floor.position.y = -2; grp.add(floor);
    let drag = false, px = 0;
    el.onpointerdown = e => { drag = true; px = e.clientX; };
    addEventListener('pointerup', () => drag = false);
    addEventListener('pointermove', e => { if (drag) { grp.rotation.y += (e.clientX - px) * .01; px = e.clientX; } });
    (function anim() { if (!drag) grp.rotation.y += .003; r.render(sc, cam); requestAnimationFrame(anim); })();
  } catch (e) { fail(el, '3D chart could not start in this browser. Use the 2D charts above.'); }
})();

initSim(); setMode('small'); requestAnimationFrame(loop);
