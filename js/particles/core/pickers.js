// pickers.js — gradient and curve editor UI components.
//
// Both pickers mutate the existing Curve / Gradient instance in target[key]
// via its .update(keys) method whenever the user edits. Identity is stable;
// only the keys + internal LUT change. Consumers (incl. the WebGPU LUT atlas
// that keys layers by instance identity) re-sync by comparing _version.
//
// Gradient picker exposes:
//   - HSV wheel for hue/saturation + value slider
//   - HDR intensity multiplier (lets RGB exceed 1.0)
//   - Alpha + position sliders
//   - Hex input
//   - Draggable stop markers along the gradient track
//   - Add / remove stops
//
// Curve picker exposes:
//   - Canvas with the curve drawn on it
//   - Draggable points; click on empty area to add; ctrl-click to remove
//   - X = lifetime (0..1), Y = value (0..1) by default

// -------------------------------------------------------------------- helpers

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function rgb01ToHex(r, g, b) {
  const to = v => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}
function hexToRgb01(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ];
}
// HSV (h:0..1, s:0..1, v:0..1) -> RGB 0..1
function hsv2rgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    case 5: return [v, p, q];
  }
}
// RGB 0..1 -> HSV
function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const v = mx;
  const d = mx - mn;
  const s = mx === 0 ? 0 : d / mx;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else               h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, s, v];
}

// -------------------------------------------------------------------- HSV wheel canvas

function paintWheel(canvas, value /* 0..1, brightness */) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const cx = W / 2, cy = H / 2;
  const radius = Math.min(cx, cy) - 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      const r = Math.hypot(dx, dy);
      const off = (y * W + x) * 4;
      if (r > radius) { img.data[off + 3] = 0; continue; }
      const angle = Math.atan2(dy, dx);
      const h = (angle / (Math.PI * 2) + 1) % 1;
      const s = r / radius;
      const [rr, gg, bb] = hsv2rgb(h, s, value);
      img.data[off]     = (rr * 255) | 0;
      img.data[off + 1] = (gg * 255) | 0;
      img.data[off + 2] = (bb * 255) | 0;
      img.data[off + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function drawWheelCursor(canvas, h, s) {
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const radius = Math.min(cx, cy) - 1;
  const angle = h * Math.PI * 2;
  const r = s * radius;
  const px = cx + Math.cos(angle) * r;
  const py = cy + Math.sin(angle) * r;
  ctx.strokeStyle = '#0c0a07';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.stroke();
}

// -------------------------------------------------------------------- gradient picker

export function gradientPicker(target, key) {
  const wrap = el('div', { class: 'grad-picker' });

  // Track preview (gradient render)
  const trackW = 280;
  const trackH = 22;
  const track = el('canvas', { class: 'grad-track', width: trackW, height: trackH });
  const trackHost = el('div', { class: 'grad-track-host' }, [track]);

  // Stop markers row (overlaps track via positioning)
  const stopsHost = el('div', { class: 'grad-stops' });
  trackHost.appendChild(stopsHost);

  // Buttons
  const addBtn = el('button', { class: 'grad-btn', html: '+' });
  const delBtn = el('button', { class: 'grad-btn', html: '✕' });
  const btnRow = el('div', { class: 'grad-btn-row' }, [addBtn, delBtn]);

  // Selected-stop controls
  const wheelW = 110, wheelH = 110;
  const wheel  = el('canvas', { class: 'grad-wheel', width: wheelW, height: wheelH });
  const overlay = el('canvas', { class: 'grad-wheel-overlay', width: wheelW, height: wheelH });
  const wheelStack = el('div', { class: 'grad-wheel-stack' }, [wheel, overlay]);

  const hexInput = el('input', { type: 'text', class: 'grad-hex', maxlength: 7, spellcheck: 'false' });
  const valLabel = el('span', { class: 'gv', html: '1.00' });
  const intLabel = el('span', { class: 'gv', html: '1.00' });
  const alphLabel= el('span', { class: 'gv', html: '1.00' });
  const posLabel = el('span', { class: 'gv', html: '0.00' });
  const valSlider = el('input', { type: 'range', min: 0, max: 1,  step: 0.01, value: 1 });
  const intSlider = el('input', { type: 'range', min: 0, max: 10, step: 0.05, value: 1 });
  const alphSlider= el('input', { type: 'range', min: 0, max: 1,  step: 0.01, value: 1 });
  const posSlider = el('input', { type: 'range', min: 0, max: 1,  step: 0.005, value: 0 });

  function row(lbl, slider, valEl) {
    return el('div', { class: 'grad-row' }, [
      el('label', { html: lbl }),
      slider,
      valEl,
    ]);
  }
  const controlsCol = el('div', { class: 'grad-controls' }, [
    el('div', { class: 'grad-row' }, [el('label', { html: 'hex' }), hexInput, el('span')]),
    row('value',  valSlider,  valLabel),
    row('intens.', intSlider, intLabel),
    row('alpha',  alphSlider, alphLabel),
    row('pos',    posSlider,  posLabel),
  ]);

  const editor = el('div', { class: 'grad-editor' }, [wheelStack, controlsCol]);

  wrap.appendChild(trackHost);
  wrap.appendChild(btnRow);
  wrap.appendChild(editor);

  // ---- state ------------------------------------------------------
  let selectedIdx = 0;
  // Per-stop UI overlay state (parallel to keys[]) — preserves which (h,s,v,intensity)
  // produced the stored RGB so the wheel cursor lands consistently.
  function uiFromColor(rgba) {
    const intensity = Math.max(rgba[0], rgba[1], rgba[2], 1);
    const r = rgba[0] / intensity, g = rgba[1] / intensity, b = rgba[2] / intensity;
    const [h, s, v] = rgb2hsv(r, g, b);
    return { h, s, v, intensity, alpha: rgba[3] };
  }
  let uiState = target[key].keys.map(([t, c]) => ({ t, ...uiFromColor(c) }));

  function applyTarget() {
    // sort by t and project ui state into [t, [r,g,b,a]] keys.
    uiState.sort((a, b) => a.t - b.t);
    const keys = uiState.map(s => {
      const [r, g, b] = hsv2rgb(s.h, s.s, s.v);
      const k = s.intensity;
      return [s.t, [r * k, g * k, b * k, s.alpha]];
    });
    target[key].update(keys);
    paintTrack();
    paintStops();
    if (selectedIdx >= uiState.length) selectedIdx = uiState.length - 1;
    refreshSelectedControls();
  }

  function paintTrack() {
    const ctx = track.getContext('2d');
    const tmp = [0,0,0,0];
    for (let x = 0; x < trackW; x++) {
      target[key].sample(x / (trackW - 1), tmp);
      // checker for transparency
      const c = ((x >> 3) & 1) ? '#1a1d23' : '#0c0a07';
      ctx.fillStyle = c;
      ctx.fillRect(x, 0, 1, trackH);
      // draw color over checker
      ctx.fillStyle = `rgba(${(clamp01(tmp[0])*255)|0},${(clamp01(tmp[1])*255)|0},${(clamp01(tmp[2])*255)|0},${tmp[3]})`;
      ctx.fillRect(x, 0, 1, trackH);
      // tiny HDR overflow indicator at the top
      if (Math.max(tmp[0], tmp[1], tmp[2]) > 1.001) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(x, 0, 1, 2);
      }
    }
  }

  function paintStops() {
    stopsHost.innerHTML = '';
    uiState.forEach((stop, i) => {
      const [r, g, b] = hsv2rgb(stop.h, stop.s, stop.v);
      const m = el('div', {
        class: 'grad-stop' + (i === selectedIdx ? ' selected' : ''),
        style: {
          left: (stop.t * 100) + '%',
          background: rgb01ToHex(r, g, b),
        },
      });
      m.dataset.idx = i;
      m.addEventListener('mousedown', (e) => startDrag(e, i));
      stopsHost.appendChild(m);
    });
  }

  function startDrag(e, idx) {
    e.preventDefault();
    e.stopPropagation();
    selectedIdx = idx;
    refreshSelectedControls();
    paintStops();
    const rect = trackHost.getBoundingClientRect();
    const move = (ev) => {
      const x = ev.clientX - rect.left;
      const t = clamp01(x / rect.width);
      uiState[idx].t = t;
      paintStops();
      applyTarget();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  // Click on the track to add a stop at that position
  trackHost.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('grad-stop')) return;
    const rect = trackHost.getBoundingClientRect();
    const t = clamp01((e.clientX - rect.left) / rect.width);
    const tmp = [0,0,0,0];
    target[key].sample(t, tmp);
    uiState.push({ t, ...uiFromColor(tmp) });
    selectedIdx = uiState.length - 1;
    applyTarget();
  });

  addBtn.addEventListener('click', () => {
    const t = uiState.length ? clamp01((uiState[selectedIdx].t + 0.05)) : 0.5;
    const tmp = [0,0,0,0];
    target[key].sample(t, tmp);
    uiState.push({ t, ...uiFromColor(tmp) });
    selectedIdx = uiState.length - 1;
    applyTarget();
  });
  delBtn.addEventListener('click', () => {
    if (uiState.length <= 1) return;
    uiState.splice(selectedIdx, 1);
    if (selectedIdx >= uiState.length) selectedIdx = uiState.length - 1;
    applyTarget();
  });

  // Wheel: click/drag picks H, S
  let wheelDragging = false;
  function pickFromWheel(e) {
    const rect = wheel.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const cx = wheelW / 2, cy = wheelH / 2;
    const radius = Math.min(cx, cy) - 1;
    const dx = x - cx, dy = y - cy;
    const r = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const h = (angle / (Math.PI * 2) + 1) % 1;
    const s = clamp01(r / radius);
    uiState[selectedIdx].h = h;
    uiState[selectedIdx].s = s;
    paintWheelOverlay();
    applyTarget();
  }
  wheel.addEventListener('mousedown', (e) => {
    wheelDragging = true; pickFromWheel(e); e.preventDefault();
  });
  overlay.addEventListener('mousedown', (e) => {
    wheelDragging = true; pickFromWheel(e); e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => { if (wheelDragging) pickFromWheel(e); });
  window.addEventListener('mouseup',   () => { wheelDragging = false; });

  function paintWheelOverlay() {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    drawWheelCursor(overlay, uiState[selectedIdx].h, uiState[selectedIdx].s);
  }

  // Sliders
  valSlider.addEventListener('input', () => {
    uiState[selectedIdx].v = parseFloat(valSlider.value);
    valLabel.textContent = uiState[selectedIdx].v.toFixed(2);
    paintWheel(wheel, uiState[selectedIdx].v);
    paintWheelOverlay();
    applyTarget();
  });
  intSlider.addEventListener('input', () => {
    uiState[selectedIdx].intensity = parseFloat(intSlider.value);
    intLabel.textContent = uiState[selectedIdx].intensity.toFixed(2);
    applyTarget();
  });
  alphSlider.addEventListener('input', () => {
    uiState[selectedIdx].alpha = parseFloat(alphSlider.value);
    alphLabel.textContent = uiState[selectedIdx].alpha.toFixed(2);
    applyTarget();
  });
  posSlider.addEventListener('input', () => {
    uiState[selectedIdx].t = parseFloat(posSlider.value);
    posLabel.textContent = uiState[selectedIdx].t.toFixed(3);
    applyTarget();
  });

  // Hex input
  hexInput.addEventListener('change', () => {
    let v = hexInput.value.trim();
    if (!/^#?[0-9a-fA-F]{3,6}$/.test(v)) return;
    const [r, g, b] = hexToRgb01(v);
    const [h, s, vv] = rgb2hsv(r, g, b);
    uiState[selectedIdx].h = h;
    uiState[selectedIdx].s = s;
    uiState[selectedIdx].v = vv;
    paintWheel(wheel, vv);
    paintWheelOverlay();
    valSlider.value = vv;
    valLabel.textContent = vv.toFixed(2);
    applyTarget();
  });

  function refreshSelectedControls() {
    const s = uiState[selectedIdx];
    if (!s) return;
    paintWheel(wheel, s.v);
    paintWheelOverlay();
    valSlider.value  = s.v;        valLabel.textContent  = s.v.toFixed(2);
    intSlider.value  = s.intensity; intLabel.textContent = s.intensity.toFixed(2);
    alphSlider.value = s.alpha;    alphLabel.textContent = s.alpha.toFixed(2);
    posSlider.value  = s.t;        posLabel.textContent  = s.t.toFixed(3);
    const [r, g, b] = hsv2rgb(s.h, s.s, s.v);
    hexInput.value = rgb01ToHex(r, g, b);
  }

  // initial paint
  applyTarget();

  return wrap;
}


// -------------------------------------------------------------------- curve picker

export function curvePicker(target, key) {
  const wrap = el('div', { class: 'curve-picker' });
  const W = 280, H = 100;
  const cv = el('canvas', { class: 'curve-canvas', width: W, height: H });
  wrap.appendChild(cv);
  const help = el('div', { class: 'curve-help', html: 'click to add · drag to move · ctrl-click to remove' });
  wrap.appendChild(help);

  const vMaxInput = el('input', { type: 'number', step: 0.1, value: '1', class: 'curve-vmax' });
  const vMaxRow = el('div', { class: 'grad-row' }, [
    el('label', { html: 'v scale' }),
    vMaxInput,
    el('span'),
  ]);
  wrap.appendChild(vMaxRow);

  // We keep a vScale factor that maps stored v in [0..vScale] to canvas y in [0..1].
  let vScale = Math.max(1, ...target[key].keys.map(k => k[1])) || 1;
  vMaxInput.value = vScale;

  const POINT_R = 5;
  let dragIdx = -1;

  function rebuild() {
    target[key].update(target[key].keys.slice().sort((a, b) => a[0] - b[0]));
    draw();
  }

  function draw() {
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0c0a07';
    ctx.fillRect(0, 0, W, H);
    // grid lines
    ctx.strokeStyle = 'rgba(240,235,224,0.10)';
    for (let i = 0; i <= 4; i++) {
      const x = i / 4 * W;
      const y = i / 4 * H;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    // curve line
    ctx.strokeStyle = '#ff4b1f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= W; x++) {
      const v = target[key].sample(x / W);
      const py = H - 4 - clamp01(v / vScale) * (H - 8);
      if (x === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
    }
    ctx.stroke();
    // points
    target[key].keys.forEach(([t, v], i) => {
      const px = t * W;
      const py = H - 4 - clamp01(v / vScale) * (H - 8);
      ctx.fillStyle = (i === dragIdx) ? '#ff4b1f' : '#f0ebe0';
      ctx.beginPath(); ctx.arc(px, py, POINT_R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0c0a07';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, POINT_R, 0, Math.PI * 2); ctx.stroke();
    });
  }

  function findHit(x, y) {
    const keys = target[key].keys;
    for (let i = 0; i < keys.length; i++) {
      const [t, v] = keys[i];
      const px = t * W;
      const py = H - 4 - clamp01(v / vScale) * (H - 8);
      if (Math.hypot(x - px, y - py) < POINT_R + 3) return i;
    }
    return -1;
  }
  function pxToTV(x, y) {
    const t = clamp01(x / W);
    const v = clamp01((H - 4 - y) / (H - 8)) * vScale;
    return [t, v];
  }

  cv.addEventListener('mousedown', (e) => {
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const hit = findHit(x, y);
    if (e.ctrlKey || e.metaKey) {
      if (hit >= 0 && target[key].keys.length > 1) {
        target[key].keys.splice(hit, 1);
        rebuild();
      }
      return;
    }
    if (hit >= 0) { dragIdx = hit; }
    else {
      const [t, v] = pxToTV(x, y);
      target[key].keys.push([t, v]);
      rebuild();
      dragIdx = target[key].keys.findIndex(k => k[0] === t && k[1] === v);
    }
    draw();
  });
  window.addEventListener('mousemove', (e) => {
    if (dragIdx < 0) return;
    const rect = cv.getBoundingClientRect();
    const [t, v] = pxToTV(e.clientX - rect.left, e.clientY - rect.top);
    target[key].keys[dragIdx] = [t, v];
    rebuild();
  });
  window.addEventListener('mouseup', () => {
    if (dragIdx >= 0) { dragIdx = -1; draw(); }
  });

  vMaxInput.addEventListener('change', () => {
    const v = parseFloat(vMaxInput.value);
    if (v > 0) { vScale = v; draw(); }
  });

  draw();
  return wrap;
}
