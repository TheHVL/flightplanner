import type { RouteLeg } from '../types';
import {
  C182T_MAX_GLIDE_CHART_MAX_HEIGHT_FT,
  maximumGlideDistanceNm,
} from '../performance/maximumGlide';
import { coordinateAtRouteDistance, totalRouteDistanceNm } from './geodesy';
import type {
  RouteVerticalEvent,
  RouteVerticalProfileResult,
} from './verticalProfile';

export interface GlideEnvelopeSample {
  routeDistanceNm: number;
  lat: number;
  lon: number;
  modeledAltitudeFtMsl: number;
  glideRangeNm: number;
}

export interface GlideEnvelopeResult {
  samples: GlideEnvelopeSample[];
  maxRangeNm: number;
  warnings: string[];
}

export interface GlideEnvelopeInput {
  legs: RouteLeg[];
  plannedAltitudesFt: Array<number | null>;
  verticalProfile: RouteVerticalProfileResult;
  sampleSpacingNm?: number;
  maxSamples?: number;
}

export function buildC182TGlideEnvelopeSamples(input: GlideEnvelopeInput): GlideEnvelopeResult {
  const {
    legs,
    plannedAltitudesFt,
    verticalProfile,
    sampleSpacingNm = 0.75,
    maxSamples = 600,
  } = input;

  if (legs.length === 0) return { samples: [], maxRangeNm: 0, warnings: [] };
  if (plannedAltitudesFt.length !== legs.length) {
    throw new Error('Planned altitude data does not match the number of route legs.');
  }
  if (!Number.isFinite(sampleSpacingNm) || sampleSpacingNm <= 0) {
    throw new Error('Glide-envelope sample spacing must be greater than zero.');
  }
  if (!Number.isInteger(maxSamples) || maxSamples < 2) {
    throw new Error('Glide-envelope max samples must be at least two.');
  }

  if (verticalProfile.profilesOverlap) {
    return {
      samples: [],
      maxRangeNm: 0,
      warnings: ['Glide overlay hidden because the vertical profile contains overlapping climb/descent segments.'],
    };
  }

  const routeDistanceNm = totalRouteDistanceNm(legs);
  const requestedSamples = Math.max(2, Math.ceil(routeDistanceNm / sampleSpacingNm) + 1);
  const sampleCount = Math.min(maxSamples, requestedSamples);
  const actualSpacingNm = sampleCount <= 1 ? 0 : routeDistanceNm / (sampleCount - 1);
  const samples: GlideEnvelopeSample[] = [];
  let missingAltitudeSamples = 0;
  let aboveChartSamples = 0;
  let maxRangeNm = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const routeDistance = index === sampleCount - 1 ? routeDistanceNm : index * actualSpacingNm;
    const altitudeFt = modeledAltitudeFtAtRouteDistance(
      legs,
      plannedAltitudesFt,
      verticalProfile.events,
      routeDistance,
    );
    if (altitudeFt === null) {
      missingAltitudeSamples += 1;
      continue;
    }
    if (altitudeFt <= 0) continue;
    if (altitudeFt > C182T_MAX_GLIDE_CHART_MAX_HEIGHT_FT) {
      aboveChartSamples += 1;
      continue;
    }

    const coordinate = coordinateAtRouteDistance(legs, routeDistance);
    if (!coordinate) continue;
    const glideRangeNm = maximumGlideDistanceNm(altitudeFt);
    maxRangeNm = Math.max(maxRangeNm, glideRangeNm);
    samples.push({
      routeDistanceNm: routeDistance,
      lat: coordinate.lat,
      lon: coordinate.lon,
      modeledAltitudeFtMsl: altitudeFt,
      glideRangeNm,
    });
  }

  const warnings: string[] = [];
  if (missingAltitudeSamples > 0) {
    warnings.push('Some glide-envelope sections are omitted because planned altitude is missing.');
  }
  if (aboveChartSamples > 0) {
    warnings.push(
      `Some glide-envelope sections are omitted above ${C182T_MAX_GLIDE_CHART_MAX_HEIGHT_FT.toLocaleString('en-US')} ft because Figure 3-1 does not extend higher.`,
    );
  }

  return { samples, maxRangeNm, warnings };
}

export function modeledAltitudeFtAtRouteDistance(
  legs: RouteLeg[],
  plannedAltitudesFt: Array<number | null>,
  events: RouteVerticalEvent[],
  routeDistanceNm: number,
): number | null {
  if (legs.length === 0 || plannedAltitudesFt.length !== legs.length || !Number.isFinite(routeDistanceNm)) {
    return null;
  }

  for (const event of events) {
    if (event.distanceNm <= 0) continue;
    const startNm = event.type === 'TOC'
      ? event.routeDistanceNm - event.distanceNm
      : event.routeDistanceNm;
    const endNm = event.type === 'TOC'
      ? event.routeDistanceNm
      : event.routeDistanceNm + event.distanceNm;

    if (routeDistanceNm < startNm - 1e-9 || routeDistanceNm > endNm + 1e-9) continue;
    const fraction = Math.min(1, Math.max(0, (routeDistanceNm - startNm) / event.distanceNm));
    return event.altitudeFromFt + (event.altitudeToFt - event.altitudeFromFt) * fraction;
  }

  let accumulatedNm = 0;
  for (let index = 0; index < legs.length; index += 1) {
    const endNm = accumulatedNm + legs[index].distanceNm;
    if (routeDistanceNm <= endNm + 1e-9 || index === legs.length - 1) {
      return plannedAltitudesFt[index];
    }
    accumulatedNm = endNm;
  }

  return plannedAltitudesFt[plannedAltitudesFt.length - 1] ?? null;
}
