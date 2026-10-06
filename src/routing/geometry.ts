type XY = readonly number[];
const EPS = 1e-9;
export function pointOnSegment(point: XY, a: XY, b: XY): boolean {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
  if (length < EPS) return Math.hypot(point[0] - a[0], point[1] - a[1]) <= EPS;
  const cross = Math.abs((point[0] - a[0]) * dy - (point[1] - a[1]) * dx);
  return cross <= EPS * length && point[0] >= Math.min(a[0], b[0]) - EPS && point[0] <= Math.max(a[0], b[0]) + EPS &&
    point[1] >= Math.min(a[1], b[1]) - EPS && point[1] <= Math.max(a[1], b[1]) + EPS;
}
export function polygonContains(point: XY, polygon: readonly XY[]): boolean {
  let inside = false;
  for (let i = 1; i < polygon.length; i++) {
    const a = polygon[i - 1], b = polygon[i];
    if (pointOnSegment(point, a, b)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/** Segment fractions include endpoint touches and collinear boundary overlaps. */
export function segmentCrossings(a: XY, b: XY, c: XY, d: XY): number[] {
  const x = b[0] - a[0], y = b[1] - a[1], u = d[0] - c[0], v = d[1] - c[1];
  const determinant = x * v - y * u;
  if (Math.abs(determinant) < EPS) {
    if (!pointOnSegment(c, a, b) && !pointOnSegment(d, a, b) && !pointOnSegment(a, c, d) && !pointOnSegment(b, c, d)) return [];
    const length2 = x * x + y * y;
    if (length2 < EPS * EPS) return pointOnSegment(a, c, d) ? [0] : [];
    return [c, d].map(p => Math.max(0, Math.min(1, ((p[0] - a[0]) * x + (p[1] - a[1]) * y) / length2)));
  }
  const t = ((c[0] - a[0]) * v - (c[1] - a[1]) * u) / determinant;
  const s = ((c[0] - a[0]) * y - (c[1] - a[1]) * x) / determinant;
  return t >= -EPS && t <= 1 + EPS && s >= -EPS && s <= 1 + EPS ? [Math.max(0, Math.min(1, t))] : [];
}
export function segmentTouchesPolygon(a: XY, b: XY, polygon: readonly XY[], buffer = 0): boolean {
  if (polygonContains(a, polygon) || polygonContains(b, polygon)) return true;
  const pointDistance = (p: XY, c: XY, d: XY) => {
    const x = d[0] - c[0], y = d[1] - c[1], length2 = x * x + y * y;
    const t = length2 ? Math.max(0, Math.min(1, ((p[0] - c[0]) * x + (p[1] - c[1]) * y) / length2)) : 0;
    return Math.hypot(p[0] - c[0] - t * x, p[1] - c[1] - t * y);
  };
  for (let i = 1; i < polygon.length; i++) {
    const c = polygon[i - 1], d = polygon[i];
    if (segmentCrossings(a, b, c, d).length || buffer > 0 && Math.min(pointDistance(a, c, d), pointDistance(b, c, d), pointDistance(c, a, b), pointDistance(d, a, b)) <= buffer) return true;
  }
  return false;
}
