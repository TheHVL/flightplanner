import { fromArrayBuffer } from 'geotiff';
import proj4 from 'proj4';
import type { Coordinate } from '../types';

export const TERRAIN_RASTER_SOURCE = 'https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833';
const UTM33 = '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs';
export interface ProjectedPoint { x: number; y: number; }
export interface TerrainRaster {
  west: number; north: number; resolutionM: number; width: number; height: number;
  elevationsM: Float32Array; fetchedAt: string; sourceUrl: string;
  sampleResolutionM?: number; aggregation?: 'max-2x2';
}
export function projectTerrainPoint(point: Coordinate): ProjectedPoint {
  const [x, y] = proj4('EPSG:4326', UTM33, [point.lon, point.lat]);
  return { x, y };
}
export function unprojectTerrainPoint(point: ProjectedPoint): Coordinate {
  const [lon, lat] = proj4(UTM33, 'EPSG:4326', [point.x, point.y]);
  return { lat, lon };
}

/** Decode the numeric DTM, never a relief image. Missing pixels stay NaN. */
export async function decodeTerrainRaster(buffer: ArrayBuffer, signal?: AbortSignal): Promise<TerrainRaster> {
  const tiff = await fromArrayBuffer(buffer, signal), image = await tiff.getImage();
  const [west, south, east, north] = image.getBoundingBox();
  const width = image.getWidth(), height = image.getHeight();
  if (image.getGeoKeys()?.ProjectedCSTypeGeoKey !== 25833 || image.getSamplesPerPixel() !== 1 ||
      width * height > 4_000_000 || width < 2 || height < 2 || ![west, south, east, north].every(Number.isFinite)) {
    throw new Error('Terrain raster has an unexpected projection, size or format.');
  }
  const resolutionM = (east - west) / width;
  if (resolutionM <= 0 || Math.abs((north - south) / height - resolutionM) > 0.1) throw new Error('Terrain raster cells are not square.');
  const data = await image.readRasters({ samples: [0], interleave: true, signal });
  const noData = image.getGDALNoData(), elevationsM = new Float32Array(width * height);
  for (let i = 0; i < elevationsM.length; i++) {
    const value = Number(data[i]);
    elevationsM[i] = !Number.isFinite(value) || value === noData || value < -10 || value > 9000 ? NaN : Math.max(0, value);
  }
  return { west, north, resolutionM, width, height, elevationsM, fetchedAt: new Date().toISOString(), sourceUrl: TERRAIN_RASTER_SOURCE };
}

/** Fresh route-window rasters, bounded memory and three service requests at once.
 * Max-pool four twice-finer WCS samples per search cell. This is still NOT
 * a maximum of the native 1 m model; peaks between source samples can be missed.
 */
export async function fetchRouteTerrainRaster(points: Coordinate[], signal: AbortSignal,
  progress?: (done: number, total: number) => void): Promise<TerrainRaster> {
  signal.throwIfAborted();
  if (points.length < 2 || points.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lon))) throw new Error('Terrain search needs valid route endpoints.');
  const projected = points.map(projectTerrainPoint), padding = 30 * 1852;
  const minX = Math.min(...projected.map(p => p.x)) - padding, maxX = Math.max(...projected.map(p => p.x)) + padding;
  const minY = Math.min(...projected.map(p => p.y)) - padding, maxY = Math.max(...projected.map(p => p.y)) + padding;
  // Keep the search data below 16 MB. Longer regional itineraries use a coarser
  // explicitly reported raster rather than silently truncating the route window.
  const resolutionM = Math.max(200, Math.ceil(Math.sqrt((maxX - minX) * (maxY - minY) / 3_500_000) / 100) * 100);
  const west = Math.floor(minX / resolutionM) * resolutionM, north = Math.ceil(maxY / resolutionM) * resolutionM;
  const width = Math.ceil((maxX - west) / resolutionM), height = Math.ceil((north - minY) / resolutionM);
  const elevationsM = new Float32Array(width * height).fill(NaN);
  const tiles: Array<{ col: number; row: number; width: number; height: number }> = [];
  for (let row = 0; row < height; row += 800) for (let col = 0; col < width; col += 800) {
    tiles.push({ col, row, width: Math.min(800, width - col), height: Math.min(800, height - row) });
  }
  let next = 0, done = 0;
  const requests = new AbortController(), cancelRequests = () => requests.abort(signal.reason);
  signal.addEventListener('abort', cancelRequests, { once: true });
  const worker = async () => {
    while (next < tiles.length) {
      requests.signal.throwIfAborted(); const tile = tiles[next++];
      const tileWest = west + tile.col * resolutionM, tileNorth = north - tile.row * resolutionM;
      const url = new URL(TERRAIN_RASTER_SOURCE);
      const params = { service: 'WCS', request: 'GetCoverage', version: '1.0.0', coverage: 'nhm_dtm_topo_25833',
        crs: 'EPSG:25833', response_crs: 'EPSG:25833', format: 'GeoTIFF', interpolation: 'nearest neighbor',
        bbox: [tileWest, tileNorth - tile.height * resolutionM, tileWest + tile.width * resolutionM, tileNorth].join(','),
        width: String(tile.width * 2), height: String(tile.height * 2) };
      Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
      const timeout = new AbortController(), abort = () => timeout.abort(requests.signal.reason);
      requests.signal.addEventListener('abort', abort, { once: true }); const timer = setTimeout(() => timeout.abort(), 45000);
      try {
        const response = await fetch(url, { signal: timeout.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`Terrain raster service unavailable (${response.status}).`);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > 24_000_000) throw new Error('Terrain service returned an oversized tile.');
        const raster = await decodeTerrainRaster(buffer, timeout.signal);
        if (raster.width !== tile.width * 2 || raster.height !== tile.height * 2 || Math.abs(raster.west - tileWest) > 1 ||
            Math.abs(raster.north - tileNorth) > 1 || Math.abs(raster.resolutionM - resolutionM / 2) > 0.1) throw new Error('Terrain tile does not match the requested window.');
        const pooled = maxPoolTerrainRaster(raster.elevationsM, raster.width, raster.height);
        for (let row = 0; row < tile.height; row++) elevationsM.set(pooled.subarray(row * tile.width, (row + 1) * tile.width), (tile.row + row) * width + tile.col);
      } catch (error) {
        signal.throwIfAborted(); requests.abort();
        throw new Error(`Terrain search data could not be loaded. No straight-line fallback was generated. ${error instanceof Error ? error.message : ''}`, { cause: error });
      } finally { clearTimeout(timer); requests.signal.removeEventListener('abort', abort); }
      requests.signal.throwIfAborted(); progress?.(++done, tiles.length);
    }
  };
  try { await Promise.all([worker(), worker(), worker()]); signal.throwIfAborted(); }
  finally { signal.removeEventListener('abort', cancelRequests); }
  return { west, north, resolutionM, sampleResolutionM: resolutionM / 2, aggregation: 'max-2x2', width, height, elevationsM, fetchedAt: new Date().toISOString(), sourceUrl: TERRAIN_RASTER_SOURCE };
}

export function maxPoolTerrainRaster(values: Float32Array, width: number, height: number): Float32Array {
  if (width % 2 || height % 2 || width < 2 || height < 2 || values.length !== width * height) throw new Error('Invalid pooling grid.');
  const result = new Float32Array(width * height / 4).fill(NaN);
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    const samples = [values[y * width + x], values[y * width + x + 1], values[(y + 1) * width + x], values[(y + 1) * width + x + 1]];
    if (samples.every(Number.isFinite)) result[(y / 2) * (width / 2) + x / 2] = Math.max(...samples);
  }
  return result;
}

function distanceToSegment(point: ProjectedPoint, from: ProjectedPoint, to: ProjectedPoint): number {
  const dx = to.x - from.x, dy = to.y - from.y, lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq)) : 0;
  return Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy);
}
/** Maximum of returned raster cells touching a rounded 1 NM corridor.
 * A missing pixel or out-of-window corridor is unknown, never sea or clear.
 */
export function rasterCorridorMaximumM(raster: TerrainRaster, from: ProjectedPoint, to: ProjectedPoint, halfWidthM = 1900): number | null {
  const radius = halfWidthM + raster.resolutionM / Math.SQRT2;
  const x0 = Math.floor((Math.min(from.x, to.x) - radius - raster.west) / raster.resolutionM);
  const x1 = Math.floor((Math.max(from.x, to.x) + radius - raster.west) / raster.resolutionM);
  const y0 = Math.floor((raster.north - Math.max(from.y, to.y) - radius) / raster.resolutionM);
  const y1 = Math.floor((raster.north - Math.min(from.y, to.y) + radius) / raster.resolutionM);
  if (x0 < 0 || y0 < 0 || x1 >= raster.width || y1 >= raster.height) return null;
  let maximum = 0;
  const dx = to.x - from.x, dy = to.y - from.y;
  for (let row = y0; row <= y1; row++) {
    const y = raster.north - (row + 0.5) * raster.resolutionM;
    let left = x0, right = x1;
    // Restrict each scan line to its capsule window. Long diagonal connectors
    // should cost O(length * corridor width), not their whole bounding box.
    if (Math.abs(dy) > 0.001) {
      const a = (y - radius - from.y) / dy, b = (y + radius - from.y) / dy;
      const low = Math.max(0, Math.min(a, b)), high = Math.min(1, Math.max(a, b));
      if (low > high) continue;
      const xA = from.x + low * dx, xB = from.x + high * dx;
      left = Math.max(x0, Math.floor((Math.min(xA, xB) - radius - raster.west) / raster.resolutionM));
      right = Math.min(x1, Math.floor((Math.max(xA, xB) + radius - raster.west) / raster.resolutionM));
    }
    for (let col = left; col <= right; col++) {
      const center = { x: raster.west + (col + 0.5) * raster.resolutionM, y };
      if (distanceToSegment(center, from, to) > radius) continue;
      const value = raster.elevationsM[row * raster.width + col];
      if (!Number.isFinite(value)) return null;
      maximum = Math.max(maximum, value);
    }
  }
  return maximum;
}
