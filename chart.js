// Minimal canvas line chart. points: [{ y: number, label: string }] in chronological order.

export function drawLineChart(canvas, points, opts = {}) {
  const { color = '#38bdf8', grid = '#334155', text = '#94a3b8', empty = 'No runs to chart yet.' } = opts;
  const dpr = globalThis.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = '12px -apple-system, system-ui, sans-serif';
  ctx.fillStyle = text;

  if (points.length === 0) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(empty, w / 2, h / 2);
    return;
  }

  const pad = { l: 40, r: 12, t: 10, b: 22 };
  const ys = points.map((p) => p.y);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (yMax - yMin < 0.2) { yMin -= 0.5; yMax += 0.5; }
  const span = yMax - yMin;
  yMin = Math.max(0, yMin - span * 0.1);
  yMax += span * 0.1;

  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const xAt = (i) => pad.l + (points.length === 1 ? plotW / 2 : (i * plotW) / (points.length - 1));
  const yAt = (v) => pad.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const ticks = 4;
  for (let k = 0; k <= ticks; k++) {
    const v = yMin + (k * (yMax - yMin)) / ticks;
    const y = yAt(v);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(yMax - yMin < 2 ? 2 : 1), pad.l - 6, y);
  }

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(points[0].label, pad.l, h - pad.b + 6);
  if (points.length > 1) {
    ctx.textAlign = 'right';
    ctx.fillText(points[points.length - 1].label, w - pad.r, h - pad.b + 6);
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(xAt(i), yAt(p.y)) : ctx.moveTo(xAt(i), yAt(p.y))));
  ctx.stroke();

  ctx.fillStyle = color;
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(xAt(i), yAt(p.y), 3, 0, Math.PI * 2);
    ctx.fill();
  });
}
