import type { RouteCandidate } from './candidates';

export function terrainResolutionLabel(terrain: RouteCandidate['searchTerrain']): string {
  const samples = terrain.sampleResolutionM ?? terrain.resolutionM;
  return `${samples} m terrain samples · ${terrain.resolutionM} m search cells · Peaks may be higher`;
}
