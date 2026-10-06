import type { Coordinate } from '../types';
import { projectTerrainPoint, unprojectTerrainPoint, rasterCorridorMaximumM, type ProjectedPoint, type TerrainRaster } from './terrainRaster';

const GRID_M = 1000, MARGIN_M = 500 * 0.3048;
export interface TerrainPath { points: Coordinate[]; highestRasterFt: number; }
class MinHeap {
  private values: Array<{ id: number; priority: number }> = [];
  push(value: { id: number; priority: number }): void {
    let i = this.values.length; this.values.push(value);
    while (i > 0) { const p = (i - 1) >> 1; if (this.values[p].priority <= value.priority) break; this.values[i] = this.values[p]; i = p; }
    this.values[i] = value;
  }
  pop(): { id: number; priority: number } | undefined {
    const first = this.values[0], last = this.values.pop();
    if (this.values.length && last) {
      let i = 0;
      while (i * 2 + 1 < this.values.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.values.length && this.values[child + 1].priority < this.values[child].priority) child++;
        if (last.priority <= this.values[child].priority) break;
        this.values[i] = this.values[child]; i = child;
      }
      this.values[i] = last;
    }
    return first;
  }
}

/** Generic geographic search, with no airport-pair routes or invented chart legs.
 * Navigable nodes conservatively cover the space between adjacent nodes; route
 * simplification must check its entire raster corridor again.
 */
export class TerrainRouter {
  private readonly width: number;
  private readonly height: number;
  private readonly maxima: Float32Array;
  private readonly blocked: Uint8Array;
  constructor(readonly raster: TerrainRaster) {
    this.width = Math.ceil(raster.width * raster.resolutionM / GRID_M);
    this.height = Math.ceil(raster.height * raster.resolutionM / GRID_M);
    if (this.width * this.height > 1_000_000) throw new Error('This itinerary covers too large an area. Generate shorter sections.');
    const base = new Float32Array(this.width * this.height), missing = new Uint8Array(base.length);
    for (let row = 0; row < raster.height; row++) for (let col = 0; col < raster.width; col++) {
      const x = Math.floor((col + 0.5) * raster.resolutionM / GRID_M), y = Math.floor((row + 0.5) * raster.resolutionM / GRID_M), id = y * this.width + x;
      const elevation = raster.elevationsM[row * raster.width + col];
      if (!Number.isFinite(elevation)) missing[id] = 1; else base[id] = Math.max(base[id], elevation);
    }
    this.maxima = new Float32Array(base.length); this.blocked = new Uint8Array(base.length);
    // Include both cell footprint and half a diagonal step. This conservatively
    // covers a 1 NM strip between grid nodes in the returned coarse raster.
    const radius = 1900 + Math.SQRT2 * GRID_M, steps = Math.ceil(radius / GRID_M);
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const id = y * this.width + x;
      for (let dy = -steps; dy <= steps; dy++) for (let dx = -steps; dx <= steps; dx++) {
        if (Math.hypot(dx, dy) * GRID_M > radius) continue;
        const col = x + dx, row = y + dy;
        if (col < 0 || row < 0 || col >= this.width || row >= this.height) { this.blocked[id] = 1; continue; }
        const other = row * this.width + col;
        this.maxima[id] = Math.max(this.maxima[id], base[other]);
        if (missing[other]) this.blocked[id] = 1;
      }
    }
  }
  private point(id: number): ProjectedPoint {
    return { x: this.raster.west + (id % this.width + 0.5) * GRID_M, y: this.raster.north - (Math.floor(id / this.width) + 0.5) * GRID_M };
  }
  private anchors(point: ProjectedPoint, ceilingAt: (p: ProjectedPoint) => number, segmentMaximum: (a: ProjectedPoint, b: ProjectedPoint) => number | null): number[] {
    const x = Math.floor((point.x - this.raster.west) / GRID_M), y = Math.floor((this.raster.north - point.y) / GRID_M);
    const anchors: number[] = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const col = x + dx, row = y + dy;
      if (col < 0 || row < 0 || col >= this.width || row >= this.height) continue;
      const id = row * this.width + col;
      if (this.blocked[id] || this.maxima[id] > ceilingAt(this.point(id))) continue;
      if (segmentMaximum(point, this.point(id)) !== null) anchors.push(id);
    }
    return anchors;
  }
  async findPath(from: Coordinate, to: Coordinate, altitudeFt: number, signal: AbortSignal,
    levels: { departureFt?: number; arrivalFt?: number } = {}, segmentAllowed: (a: ProjectedPoint, b: ProjectedPoint) => boolean = () => true): Promise<TerrainPath | null> {
    signal.throwIfAborted();
    const start = projectTerrainPoint(from), finish = projectTerrainPoint(to), ceilingM = altitudeFt * 0.3048 - MARGIN_M;
    // Conservative geometric climb/descent allowance near chart-limited gates.
    // Actual C182T POH and vertical profiles are checked independently afterwards.
    const ceilingAt = (point: ProjectedPoint) => Math.min(altitudeFt,
      levels.departureFt === undefined ? altitudeFt : levels.departureFt + Math.hypot(point.x - start.x, point.y - start.y) / 1852 * 200,
      levels.arrivalFt === undefined ? altitudeFt : levels.arrivalFt + Math.hypot(point.x - finish.x, point.y - finish.y) / 1852 * 250) * 0.3048 - MARGIN_M;
    const varyingLevels = levels.departureFt !== undefined || levels.arrivalFt !== undefined;
    const segmentMaximum = (a: ProjectedPoint, b: ProjectedPoint): number | null => {
      if (!segmentAllowed(a, b)) return null;
      const steps = varyingLevels ? Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 500)) : 1;
      let maximum = 0;
      for (let i = 0; i < steps; i++) {
        const p = { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps };
        const q = { x: a.x + (b.x - a.x) * (i + 1) / steps, y: a.y + (b.y - a.y) * (i + 1) / steps };
        const value = rasterCorridorMaximumM(this.raster, p, q);
        if (value === null || value > Math.min(ceilingAt(p), ceilingAt(q))) return null;
        maximum = Math.max(maximum, value);
      }
      return maximum;
    };
    const direct = segmentMaximum(start, finish);
    const starts = this.anchors(start, ceilingAt, segmentMaximum), goals = new Set(this.anchors(finish, ceilingAt, segmentMaximum));
    if (!starts.length || !goals.size) return direct !== null ? { points: [from, to], highestRasterFt: direct / 0.3048 } : null;
    const size = this.maxima.length, cost = new Float64Array(size).fill(Infinity), previous = new Int32Array(size).fill(-1), closed = new Uint8Array(size);
    const heap = new MinHeap();
    for (const id of starts) { const p = this.point(id); cost[id] = Math.hypot(p.x - start.x, p.y - start.y); heap.push({ id, priority: cost[id] + Math.hypot(p.x - finish.x, p.y - finish.y) }); }
    let found = -1, best = Infinity, iterations = 0;
    while (true) {
      const item = heap.pop(); if (!item || item.priority >= best) break;
      const id = item.id; if (closed[id]) continue; closed[id] = 1;
      const point = this.point(id);
      if (goals.has(id)) { const total = cost[id] + Math.hypot(point.x - finish.x, point.y - finish.y); if (total < best) { best = total; found = id; } }
      const x = id % this.width, y = Math.floor(id / this.width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const col = x + dx, row = y + dy;
        if (col < 0 || row < 0 || col >= this.width || row >= this.height) continue;
        const next = row * this.width + col;
        if (closed[next] || this.blocked[next] || this.maxima[next] > ceilingAt(this.point(next))) continue;
        if (!segmentAllowed(point, this.point(next))) continue;
        const step = Math.hypot(dx, dy) * GRID_M;
        const terrainPreference = 1 + 0.35 * (this.maxima[next] / Math.max(1, ceilingM)) ** 2;
        const nextCost = cost[id] + step * terrainPreference;
        if (nextCost >= cost[next]) continue;
        cost[next] = nextCost; previous[next] = id;
        const p = this.point(next); heap.push({ id: next, priority: nextCost + Math.hypot(p.x - finish.x, p.y - finish.y) });
      }
      if (++iterations % 2000 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
    }
    if (found < 0) return null;
    const path: ProjectedPoint[] = [];
    for (let id = found; id >= 0; id = previous[id]) path.push(this.point(id));
    path.reverse(); path.unshift(start); path.push(finish);
    // Remove grid zigzags only when the shortcut retains its corridor margin.
    const simplified = [start]; let index = 0, highest = 0;
    while (index < path.length - 1) {
      let next = path.length - 1, maximum: number | null = null;
      for (; next > index; next--) {
        maximum = segmentMaximum(path[index], path[next]);
        if (maximum !== null) break;
      }
      if (next === index || maximum === null) return null;
      highest = Math.max(highest, maximum); simplified.push(path[next]); index = next;
    }
    signal.throwIfAborted();
    return { points: simplified.map(unprojectTerrainPoint), highestRasterFt: highest / 0.3048 };
  }
}
