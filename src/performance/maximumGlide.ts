export const C182T_MAX_GLIDE_CHART_MAX_HEIGHT_FT = 14_000;
export const C182T_MAX_GLIDE_CHART_MAX_DISTANCE_NM = 20;

// Cessna 182T POH Figure 3-1 is a straight maximum-glide line from approximately
// 0 NM / 0 ft to 20 NM / 14,000 ft. This visual planning model therefore uses
// 700 ft of height above the assumed landing surface per nautical mile.
export const C182T_MAX_GLIDE_FT_PER_NM =
  C182T_MAX_GLIDE_CHART_MAX_HEIGHT_FT / C182T_MAX_GLIDE_CHART_MAX_DISTANCE_NM;

export const C182T_BEST_GLIDE_SPEEDS = [
  { weightLb: 3100, kias: 76 },
  { weightLb: 2600, kias: 70 },
  { weightLb: 2100, kias: 58 },
] as const;

export function maximumGlideDistanceNm(heightAboveLandingSurfaceFt: number): number {
  if (!Number.isFinite(heightAboveLandingSurfaceFt) || heightAboveLandingSurfaceFt < 0) {
    throw new Error('Height above landing surface must be a finite non-negative value.');
  }
  if (heightAboveLandingSurfaceFt > C182T_MAX_GLIDE_CHART_MAX_HEIGHT_FT) {
    throw new Error(
      `C182T Figure 3-1 glide data is only represented through ${C182T_MAX_GLIDE_CHART_MAX_HEIGHT_FT.toLocaleString('en-US')} ft.`,
    );
  }
  return heightAboveLandingSurfaceFt / C182T_MAX_GLIDE_FT_PER_NM;
}
