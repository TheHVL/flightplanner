import type { RadioCatalog } from '../frequencies/catalog';
import { projectTerrainPoint, type ProjectedPoint, type TerrainRaster } from './terrainRaster';
import { segmentTouchesPolygon } from './geometry';

export function hasRestrictionCoverage(catalog: RadioCatalog | null): boolean {
  return !!catalog?.restrictionCoverage && Array.isArray(catalog.restrictions) && catalog.restrictionCoverage.publishedAreaCount > 0 &&
    catalog.restrictions.length === catalog.restrictionCoverage.publishedAreaCount;
}
/** Conservative horizontal avoidance of all published P/R/D footprints, regardless of activity or altitude.
 * The 250 m buffer is a search allowance, not a legal or operational clearance margin.
 */
export function restrictionSegmentAllowed(catalog: RadioCatalog | null, raster: TerrainRaster): (a: ProjectedPoint, b: ProjectedPoint) => boolean {
  const buffer = 250;
  const polygons = (catalog?.restrictions ?? []).flatMap(area => area.volumes.map(volume => {
    const polygon = volume.polygon.map(([lon, lat]) => { const point = projectTerrainPoint({ lon, lat }); return [point.x, point.y]; });
    const bounds = [Math.min(...polygon.map(p => p[0])) - buffer, Math.min(...polygon.map(p => p[1])) - buffer,
      Math.max(...polygon.map(p => p[0])) + buffer, Math.max(...polygon.map(p => p[1])) + buffer];
    return { polygon, bounds };
  })).filter(({ bounds }) => bounds[2] >= raster.west && bounds[0] <= raster.west + raster.width * raster.resolutionM &&
    bounds[3] >= raster.north - raster.height * raster.resolutionM && bounds[1] <= raster.north);
  return (a, b) => !polygons.some(({ polygon, bounds }) => Math.max(a.x, b.x) >= bounds[0] && Math.min(a.x, b.x) <= bounds[2] &&
    Math.max(a.y, b.y) >= bounds[1] && Math.min(a.y, b.y) <= bounds[3] && segmentTouchesPolygon([a.x, a.y], [b.x, b.y], polygon, buffer));
}
