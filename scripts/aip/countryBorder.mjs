/** Kartverket country-border curves resolve the AIP's literal border-following edges. */
export function createBorderResolver(features) {
  const nodes = new Map();
  const key = p => p.map(n => Number(n).toFixed(6)).join(',');
  const node = p => { const k = key(p); if (!nodes.has(k)) nodes.set(k, { point: p.slice(0, 2), adjacent: new Set() }); return k; };
  const segments = [];
  for (const f of features) {
    if (!['Riksgrense', 'AvtaltAvgrensningslinje'].includes(f.properties?.avgrensningstype) || f.geometry?.type !== 'LineString') continue;
    const points = f.geometry.coordinates;
    for (let i = 1; i < points.length; i++) {
      const a = node(points[i - 1]), b = node(points[i]);
      nodes.get(a).adjacent.add(b); nodes.get(b).adjacent.add(a);
      segments.push([a, b]);
    }
  }
  if (segments.length < 100) throw new Error('Kartverket country-border data are incomplete.');
  const snap = p => {
    let best;
    for (const [a, b] of segments) {
      const x = nodes.get(a).point, y = nodes.get(b).point;
      const cos = Math.cos(p[1] * Math.PI / 180);
      const dx = (y[0] - x[0]) * cos, dy = y[1] - x[1];
      const t = Math.max(0, Math.min(1, (((p[0] - x[0]) * cos) * dx + (p[1] - x[1]) * dy) / (dx * dx + dy * dy || 1)));
      const point = [x[0] + t * (y[0] - x[0]), x[1] + t * (y[1] - x[1])];
      const d = Math.hypot((p[0] - point[0]) * cos, p[1] - point[1]) * 111.2;
      if (!best || d < best.d) best = { a, b, point, d };
    }
    if (!best || best.d > 1.0) throw new Error(`AIP border coordinate cannot be resolved against Kartverket (${p.join(',')}, ${best?.d.toFixed(2)} km).`);
    return best;
  };
  return (from, to) => {
    const a = snap(from), b = snap(to);
    if (a.a === b.a && a.b === b.b) return [from, a.point, b.point, to];
    const previous = new Map([[a.a, null], [a.b, null]]), queue = [a.a, a.b];
    let found;
    for (let i = 0; i < queue.length; i++) {
      const k = queue[i]; if (k === b.a || k === b.b) { found = k; break; }
      for (const next of nodes.get(k).adjacent) if (!previous.has(next)) { previous.set(next, k); queue.push(next); }
    }
    if (!found) throw new Error('AIP border segment is not connected in Kartverket data.');
    const path = [];
    for (let k = found; k !== null; k = previous.get(k)) path.push(nodes.get(k).point);
    return simplify([from, a.point, ...path.reverse(), b.point, to]).map(p => p.map(n => Number(n.toFixed(6))));
  };
}

// Retain endpoints and bound the border-curve simplification to 20 m.
function simplify(points) {
  if (points.length <= 2) return points;
  const keep = new Set([0, points.length - 1]), pending = [[0, points.length - 1]];
  while (pending.length) {
    const [start, end] = pending.pop(), a = points[start], b = points[end];
    let worst = 0.02, index = -1;
    for (let i = start + 1; i < end; i++) {
      const p = points[i], cos = Math.cos(p[1] * Math.PI / 180);
      const dx = (b[0] - a[0]) * cos, dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, (((p[0] - a[0]) * cos) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot((p[0] - a[0] - t * (b[0] - a[0])) * cos, p[1] - a[1] - t * dy) * 111.2;
      if (d > worst) { worst = d; index = i; }
    }
    if (index >= 0) { keep.add(index); pending.push([start, index], [index, end]); }
  }
  return [...keep].sort((a, b) => a - b).map(i => points[i]);
}
