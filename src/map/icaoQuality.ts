export type ChartDetailMode = 'auto' | 'sharp' | 'fast';

const WEB_MERCATOR_INITIAL_RESOLUTION = 156543.03392804097;
const VFR_SOURCE_RESOLUTION_M_PER_PX = 31.75;
export const ICAO_TILE_CSS_PX = 256;

export function webMercatorTileCentreLatitudeDeg(z: number, y: number): number {
  const n = Math.PI - (2 * Math.PI * (y + 0.5)) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

export function chartDetailRatioCap(z: number, mode: ChartDetailMode): number {
  if (mode === 'sharp') return 4;
  if (mode === 'fast') return 1;
  return z <= 9 ? 2 : 4;
}

export function vfrPixelRatio(
  z: number,
  y: number,
  devicePixelRatio = 1,
  mode: ChartDetailMode = 'auto',
): number {
  const latitudeRad = (webMercatorTileCentreLatitudeDeg(z, y) * Math.PI) / 180;
  const cssResolutionMPerPx =
    (WEB_MERCATOR_INITIAL_RESOLUTION * Math.cos(latitudeRad)) / 2 ** z;
  const sourceMatchRatio = cssResolutionMPerPx / VFR_SOURCE_RESOLUTION_M_PER_PX;
  const wantedRatio = Math.min(sourceMatchRatio, chartDetailRatioCap(z, mode));

  return Math.min(4, Math.max(1, devicePixelRatio > 0 ? devicePixelRatio : 1, wantedRatio));
}

export function vfrTilePixels(
  z: number,
  y: number,
  devicePixelRatio = 1,
  mode: ChartDetailMode = 'auto',
): number {
  const requested = ICAO_TILE_CSS_PX * vfrPixelRatio(z, y, devicePixelRatio, mode);
  return Math.ceil(requested / 8) * 8;
}
