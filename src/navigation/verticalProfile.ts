import type { Coordinate, RouteLeg } from '../types';
import { calculateC182TClimb, type C182TClimbProfile } from '../performance/climbPerformance';
import { totalRouteDistanceNm } from './geodesy';
import { solveWindTriangle } from './wind';

export interface VerticalProfileInput {
  legs: RouteLeg[];
  departureElevationFt: number;
  destinationElevationFt: number;
  initialPlannedAltitudeFt: number;
  finalPlannedAltitudeFt: number;
  climbRateFpm: number;
  descentRateFpm: number;
  climbGroundSpeedKt: number;
  descentGroundSpeedKt: number;
}

export interface VerticalProfileResult {
  routeDistanceNm: number;
  climbAltitudeGainFt: number;
  descentAltitudeLossFt: number;
  climbTimeMin: number;
  descentTimeMin: number;
  climbDistanceNm: number;
  descentDistanceNm: number;
  tocDistanceFromDepartureNm: number;
  todDistanceFromDepartureNm: number;
  todDistanceToDestinationNm: number;
  levelDistanceNm: number;
  profilesOverlap: boolean;
  overlapDistanceNm: number;
  tocOnRoute: boolean;
  todOnRoute: boolean;
  tocCoordinate: Coordinate | null;
  todCoordinate: Coordinate | null;
}

export type VerticalWaypointMode = 'auto' | 'airport' | 'circuits' | 'none';
export type ClimbPerformanceMode = 'manual' | 'poh-normal-90' | 'poh-max-rate';

export interface VerticalWaypointConstraint {
  waypointId: string;
  mode: VerticalWaypointMode;
  elevationFt: number | null;
}

export interface VerticalLegWind {
  windFromDeg: number;
  windSpeedKt: number;
}

export type VerticalEventType = 'TOC' | 'TOD';
export type VerticalEventReason = 'departure' | 'arrival' | 'pl-change' | 'airport';

export interface RouteVerticalEvent {
  id: string;
  type: VerticalEventType;
  reason: VerticalEventReason;
  waypointId: string;
  waypointName: string;
  position: 'before' | 'after';
  altitudeFromFt: number;
  altitudeToFt: number;
  altitudeChangeFt: number;
  timeMin: number;
  distanceNm: number;
  fuelGal: number | null;
  performanceSource: ClimbPerformanceMode;
  /** Phase TAS used to turn climb/descent time into wind-corrected ground distance. */
  phaseTasKt: number;
  /** Figure 5-8 zero-wind distance for POH climbs. Null for manual phases. */
  zeroWindDistanceNm: number | null;
  routeDistanceNm: number;
  distanceFromWaypointNm: number;
  onRoute: boolean;
  coordinate: Coordinate | null;
}

export interface RouteVerticalProfileInput {
  legs: RouteLeg[];
  plannedAltitudesFt: Array<number | null>;
  waypointConstraints: VerticalWaypointConstraint[];
  departureElevationFt: number;
  destinationElevationFt: number;
  climbRateFpm: number;
  descentRateFpm: number;
  /** Legacy field name retained for stored/UI compatibility. Used as manual climb TAS when legWinds is supplied. */
  climbGroundSpeedKt: number;
  /** Legacy field name retained for stored/UI compatibility. Used as descent TAS when legWinds is supplied. */
  descentGroundSpeedKt: number;
  climbPerformanceMode?: ClimbPerformanceMode;
  climbOatC?: number | null;
  /** Optional active wind for every route leg. When supplied, TOC/TOD ground positions are wind-aware. */
  legWinds?: Array<VerticalLegWind | null>;
  /** Optional per-leg OAT. The outbound leg value is preferred for a climb's Figure 5-8 temperature correction. */
  legOatC?: Array<number | null>;
}

export interface RouteVerticalProfileResult {
  routeDistanceNm: number;
  events: RouteVerticalEvent[];
  levelDistanceNm: number;
  verticalDistanceNm: number;
  overlapDistanceNm: number;
  profilesOverlap: boolean;
  climbPerformanceIncomplete: boolean;
  warnings: string[];
}

interface VerticalInterval {
  startNm: number;
  endNm: number;
}

interface PhaseWalkResult {
  routeDistanceNm: number;
  groundDistanceNm: number;
}

const EPSILON = 1e-9;

export function calculateRouteVerticalProfile(input: RouteVerticalProfileInput): RouteVerticalProfileResult {
  const {
    legs,
    plannedAltitudesFt,
    waypointConstraints,
    departureElevationFt,
    destinationElevationFt,
    climbRateFpm,
    descentRateFpm,
    climbGroundSpeedKt,
    descentGroundSpeedKt,
    climbPerformanceMode = 'manual',
    climbOatC = null,
    legWinds,
    legOatC,
  } = input;

  if (legs.length === 0) throw new Error('Add at least two waypoints before calculating TOC/TOD.');
  if (plannedAltitudesFt.length !== legs.length) {
    throw new Error('Planned altitude data does not match the number of route legs.');
  }
  if (legWinds && legWinds.length !== legs.length) {
    throw new Error('Vertical-profile wind data does not match the number of route legs.');
  }
  if (legOatC && legOatC.length !== legs.length) {
    throw new Error('Vertical-profile temperature data does not match the number of route legs.');
  }
  validateFiniteNonNegative(departureElevationFt, 'Departure elevation');
  validateFiniteNonNegative(destinationElevationFt, 'Destination elevation');
  validatePositive(climbRateFpm, 'Climb rate');
  validatePositive(descentRateFpm, 'Descent rate');
  validatePositive(climbGroundSpeedKt, legWinds ? 'Manual climb TAS' : 'Climb groundspeed');
  validatePositive(descentGroundSpeedKt, legWinds ? 'Descent TAS' : 'Descent groundspeed');

  plannedAltitudesFt.forEach((altitude, index) => {
    if (altitude !== null) validateFiniteNonNegative(altitude, `Leg ${index + 1} planned altitude`);
  });

  const routeDistanceNm = totalRouteDistanceNm(legs);
  const waypointDistancesNm = cumulativeWaypointDistances(legs);
  const constraints = new Map(waypointConstraints.map((constraint) => [constraint.waypointId, constraint]));
  const events: RouteVerticalEvent[] = [];
  const intervals: VerticalInterval[] = [];
  const warnings: string[] = [];
  let climbPerformanceIncomplete = false;

  const waypointAt = (index: number) => index === 0 ? legs[0].from : legs[index - 1].to;
  const climbOatAt = (anchorIndex: number): number | null => {
    if (legOatC && legOatC.length > 0) {
      const index = Math.min(Math.max(anchorIndex, 0), legOatC.length - 1);
      const value = legOatC[index];
      if (value !== null && Number.isFinite(value)) return value;
    }
    return climbOatC;
  };

  const addClimb = (
    anchorIndex: number,
    altitudeFromFt: number,
    altitudeToFt: number,
    reason: VerticalEventReason,
  ) => {
    const altitudeChangeFt = altitudeToFt - altitudeFromFt;
    if (altitudeChangeFt <= 0) return;

    let timeMin: number;
    let zeroWindDistanceNm: number | null = null;
    let fuelGal: number | null = null;
    let performanceSource: ClimbPerformanceMode = 'manual';
    let phaseTasKt = climbGroundSpeedKt;

    if (climbPerformanceMode === 'manual') {
      timeMin = altitudeChangeFt / climbRateFpm;
    } else {
      const profile: C182TClimbProfile = climbPerformanceMode === 'poh-normal-90' ? 'normal-90' : 'max-rate';
      try {
        const climb = calculateC182TClimb({
          profile,
          startPressureAltitudeFt: altitudeFromFt,
          endPressureAltitudeFt: altitudeToFt,
          oatC: climbOatAt(anchorIndex),
        });
        timeMin = climb.timeMin;
        zeroWindDistanceNm = climb.distanceNm;
        fuelGal = climb.fuelUsedGal;
        performanceSource = climbPerformanceMode;
        phaseTasKt = timeMin > EPSILON ? climb.distanceNm / (timeMin / 60) : climb.targetClimbSpeedKias;
      } catch (error) {
        climbPerformanceIncomplete = true;
        const message = error instanceof Error ? error.message : 'POH Figure 5-8 climb performance could not be calculated.';
        warnings.push(`${waypointAt(anchorIndex).name}: ${message}`);
        return;
      }
    }

    const anchorDistanceNm = waypointDistancesNm[anchorIndex];
    const walk = legWinds
      ? walkPhaseForward(legs, waypointDistancesNm, legWinds, anchorDistanceNm, timeMin, phaseTasKt)
      : {
          routeDistanceNm: anchorDistanceNm + (zeroWindDistanceNm ?? climbGroundSpeedKt * timeMin / 60),
          groundDistanceNm: zeroWindDistanceNm ?? climbGroundSpeedKt * timeMin / 60,
        };
    const distanceNm = walk.groundDistanceNm;
    const routeEventDistanceNm = walk.routeDistanceNm;
    const waypoint = waypointAt(anchorIndex);
    const onRoute = routeEventDistanceNm >= 0 && routeEventDistanceNm <= routeDistanceNm;
    const event: RouteVerticalEvent = {
      id: `toc-${waypoint.id}-${events.length}`,
      type: 'TOC',
      reason,
      waypointId: waypoint.id,
      waypointName: waypoint.name,
      position: 'after',
      altitudeFromFt,
      altitudeToFt,
      altitudeChangeFt,
      timeMin,
      distanceNm,
      fuelGal,
      performanceSource,
      phaseTasKt,
      zeroWindDistanceNm,
      routeDistanceNm: routeEventDistanceNm,
      distanceFromWaypointNm: distanceNm,
      onRoute,
      coordinate: onRoute ? routeCoordinateAtDistance(legs, routeEventDistanceNm) : null,
    };
    events.push(event);
    intervals.push({ startNm: anchorDistanceNm, endNm: routeEventDistanceNm });
    if (!onRoute) warnings.push(`TOC after ${waypoint.name} falls beyond the plotted route.`);
    if (reason === 'pl-change' && anchorIndex < legs.length && distanceNm > legs[anchorIndex].distanceNm) {
      warnings.push(`The selected climb cannot reach ${Math.round(altitudeToFt)} ft before ${legs[anchorIndex].to.name}; it needs ${roundHalfNm(distanceNm - legs[anchorIndex].distanceNm)} NM more at the active climb TAS/wind.`);
    }
  };

  const addDescentBefore = (
    anchorIndex: number,
    altitudeFromFt: number,
    altitudeToFt: number,
    reason: VerticalEventReason,
  ) => {
    const altitudeChangeFt = altitudeFromFt - altitudeToFt;
    if (altitudeChangeFt <= 0) return;
    const timeMin = altitudeChangeFt / descentRateFpm;
    const phaseTasKt = descentGroundSpeedKt;
    const anchorDistanceNm = waypointDistancesNm[anchorIndex];
    const walk = legWinds
      ? walkPhaseBackward(legs, waypointDistancesNm, legWinds, anchorDistanceNm, timeMin, phaseTasKt)
      : {
          routeDistanceNm: anchorDistanceNm - descentGroundSpeedKt * timeMin / 60,
          groundDistanceNm: descentGroundSpeedKt * timeMin / 60,
        };
    const routeEventDistanceNm = walk.routeDistanceNm;
    const distanceNm = walk.groundDistanceNm;
    const waypoint = waypointAt(anchorIndex);
    const onRoute = routeEventDistanceNm >= 0 && routeEventDistanceNm <= routeDistanceNm;
    const event: RouteVerticalEvent = {
      id: `tod-${waypoint.id}-${events.length}`,
      type: 'TOD',
      reason,
      waypointId: waypoint.id,
      waypointName: waypoint.name,
      position: 'before',
      altitudeFromFt,
      altitudeToFt,
      altitudeChangeFt,
      timeMin,
      distanceNm,
      fuelGal: null,
      performanceSource: 'manual',
      phaseTasKt,
      zeroWindDistanceNm: null,
      routeDistanceNm: routeEventDistanceNm,
      distanceFromWaypointNm: distanceNm,
      onRoute,
      coordinate: onRoute ? routeCoordinateAtDistance(legs, routeEventDistanceNm) : null,
    };
    events.push(event);
    intervals.push({ startNm: routeEventDistanceNm, endNm: anchorDistanceNm });
    if (!onRoute) warnings.push(`TOD before ${waypoint.name} falls before the plotted route starts.`);
  };

  // A PL reduction belongs to the outbound leg. Work backwards from the next waypoint
  // using descent TAS and the active wind, but never move TOD before the waypoint where
  // the lower outbound PL begins.
  const addPlChangeDescent = (
    anchorIndex: number,
    altitudeFromFt: number,
    altitudeToFt: number,
  ) => {
    if (anchorIndex >= legs.length) return;
    const altitudeChangeFt = altitudeFromFt - altitudeToFt;
    if (altitudeChangeFt <= 0) return;
    const timeMin = altitudeChangeFt / descentRateFpm;
    const phaseTasKt = descentGroundSpeedKt;
    const anchorDistanceNm = waypointDistancesNm[anchorIndex];
    const nextWaypointDistanceNm = waypointDistancesNm[anchorIndex + 1];
    const backward = legWinds
      ? walkPhaseBackward(legs, waypointDistancesNm, legWinds, nextWaypointDistanceNm, timeMin, phaseTasKt)
      : {
          routeDistanceNm: nextWaypointDistanceNm - descentGroundSpeedKt * timeMin / 60,
          groundDistanceNm: descentGroundSpeedKt * timeMin / 60,
        };
    const idealTodDistanceNm = backward.routeDistanceNm;
    const routeEventDistanceNm = Math.max(anchorDistanceNm, idealTodDistanceNm);
    const distanceNm = backward.groundDistanceNm;
    const profileEndDistanceNm = routeEventDistanceNm + distanceNm;
    const waypoint = waypointAt(anchorIndex);
    const onRoute = routeEventDistanceNm >= 0 && routeEventDistanceNm <= routeDistanceNm;

    events.push({
      id: `tod-${waypoint.id}-${events.length}`,
      type: 'TOD',
      reason: 'pl-change',
      waypointId: waypoint.id,
      waypointName: waypoint.name,
      position: 'after',
      altitudeFromFt,
      altitudeToFt,
      altitudeChangeFt,
      timeMin,
      distanceNm,
      fuelGal: null,
      performanceSource: 'manual',
      phaseTasKt,
      zeroWindDistanceNm: null,
      routeDistanceNm: routeEventDistanceNm,
      distanceFromWaypointNm: Math.max(0, routeEventDistanceNm - anchorDistanceNm),
      onRoute,
      coordinate: onRoute ? routeCoordinateAtDistance(legs, routeEventDistanceNm) : null,
    });
    intervals.push({ startNm: routeEventDistanceNm, endNm: profileEndDistanceNm });

    if (idealTodDistanceNm < anchorDistanceNm - EPSILON) {
      const shortByNm = Math.max(0, distanceNm - legs[anchorIndex].distanceNm);
      warnings.push(`The selected descent from ${waypoint.name} cannot reach ${Math.round(altitudeToFt)} ft by ${legs[anchorIndex].to.name}; it needs ${roundHalfNm(shortByNm)} NM more at the active descent TAS/wind. TOD has been held at/after ${waypoint.name}, never before it.`);
    }
  };

  const firstPlannedAltitudeFt = plannedAltitudesFt[0];
  if (firstPlannedAltitudeFt === null) {
    warnings.push(`Enter PL for ${legs[0].from.name} → ${legs[0].to.name} to calculate the departure climb.`);
  } else if (firstPlannedAltitudeFt > departureElevationFt) {
    addClimb(0, departureElevationFt, firstPlannedAltitudeFt, 'departure');
  } else if (firstPlannedAltitudeFt < departureElevationFt) {
    warnings.push('The first-leg PL is below the departure elevation. No automatic departure climb was created.');
  }

  for (let waypointIndex = 1; waypointIndex < legs.length; waypointIndex += 1) {
    const waypoint = waypointAt(waypointIndex);
    const inboundAltitudeFt = plannedAltitudesFt[waypointIndex - 1];
    const outboundAltitudeFt = plannedAltitudesFt[waypointIndex];
    const constraint = constraints.get(waypoint.id) ?? { waypointId: waypoint.id, mode: 'auto' as const, elevationFt: null };

    if (constraint.mode === 'none') continue;

    if (constraint.mode === 'airport' || constraint.mode === 'circuits') {
      if (constraint.elevationFt === null) {
        warnings.push(`Enter field elevation for ${waypoint.name} to calculate its airport profile.`);
        continue;
      }
      validateFiniteNonNegative(constraint.elevationFt, `${waypoint.name} field elevation`);

      if (inboundAltitudeFt !== null) {
        if (inboundAltitudeFt > constraint.elevationFt) {
          addDescentBefore(waypointIndex, inboundAltitudeFt, constraint.elevationFt, 'airport');
        } else if (inboundAltitudeFt < constraint.elevationFt) {
          warnings.push(`${waypoint.name} inbound PL is below its field elevation.`);
        }
      } else {
        warnings.push(`Enter inbound PL before ${waypoint.name} to calculate its TOD.`);
      }

      if (outboundAltitudeFt !== null) {
        if (outboundAltitudeFt > constraint.elevationFt) {
          addClimb(waypointIndex, constraint.elevationFt, outboundAltitudeFt, 'airport');
        } else if (outboundAltitudeFt < constraint.elevationFt) {
          warnings.push(`${waypoint.name} outbound PL is below its field elevation.`);
        }
      } else {
        warnings.push(`Enter outbound PL after ${waypoint.name} to calculate its TOC.`);
      }
      continue;
    }

    if (inboundAltitudeFt === null || outboundAltitudeFt === null) {
      warnings.push(`Enter PL on both sides of ${waypoint.name} to calculate its automatic altitude transition.`);
      continue;
    }

    if (outboundAltitudeFt > inboundAltitudeFt) {
      addClimb(waypointIndex, inboundAltitudeFt, outboundAltitudeFt, 'pl-change');
    } else if (outboundAltitudeFt < inboundAltitudeFt) {
      addPlChangeDescent(waypointIndex, inboundAltitudeFt, outboundAltitudeFt);
    }
  }

  const finalPlannedAltitudeFt = plannedAltitudesFt[plannedAltitudesFt.length - 1];
  const destinationIndex = legs.length;
  if (finalPlannedAltitudeFt === null) {
    warnings.push(`Enter PL for ${legs[legs.length - 1].from.name} → ${legs[legs.length - 1].to.name} to calculate arrival TOD.`);
  } else if (finalPlannedAltitudeFt > destinationElevationFt) {
    addDescentBefore(destinationIndex, finalPlannedAltitudeFt, destinationElevationFt, 'arrival');
  } else if (finalPlannedAltitudeFt < destinationElevationFt) {
    warnings.push('The final-leg PL is below the destination elevation. No automatic arrival descent was created.');
  }

  events.sort((a, b) => a.routeDistanceNm - b.routeDistanceNm || a.type.localeCompare(b.type));

  const clippedIntervals = intervals
    .map((interval) => ({
      startNm: Math.max(0, Math.min(routeDistanceNm, Math.min(interval.startNm, interval.endNm))),
      endNm: Math.max(0, Math.min(routeDistanceNm, Math.max(interval.startNm, interval.endNm))),
    }))
    .filter((interval) => interval.endNm > interval.startNm);

  const totalVerticalDistanceNm = clippedIntervals.reduce((sum, interval) => sum + interval.endNm - interval.startNm, 0);
  const unionDistanceNm = intervalUnionDistance(clippedIntervals);
  const overlapDistanceNm = Math.max(0, totalVerticalDistanceNm - unionDistanceNm);
  const profilesOverlap = overlapDistanceNm > 1e-6;
  if (profilesOverlap) {
    warnings.push(`Vertical profiles overlap by ${roundHalfNm(overlapDistanceNm)} NM. Review PL, vertical rates, phase TAS/wind, or airport constraints.`);
  }

  return {
    routeDistanceNm,
    events,
    levelDistanceNm: Math.max(0, routeDistanceNm - unionDistanceNm),
    verticalDistanceNm: unionDistanceNm,
    overlapDistanceNm,
    profilesOverlap,
    climbPerformanceIncomplete,
    warnings: unique(warnings),
  };
}

export function calculateVerticalProfile(input: VerticalProfileInput): VerticalProfileResult {
  const {
    legs,
    departureElevationFt,
    destinationElevationFt,
    initialPlannedAltitudeFt,
    finalPlannedAltitudeFt,
    climbRateFpm,
    descentRateFpm,
    climbGroundSpeedKt,
    descentGroundSpeedKt,
  } = input;

  if (legs.length === 0) throw new Error('Add at least two waypoints before calculating TOC/TOD.');
  validateFiniteNonNegative(departureElevationFt, 'Departure elevation');
  validateFiniteNonNegative(destinationElevationFt, 'Destination elevation');
  validateFiniteNonNegative(initialPlannedAltitudeFt, 'Initial planned altitude');
  validateFiniteNonNegative(finalPlannedAltitudeFt, 'Final planned altitude');
  validatePositive(climbRateFpm, 'Climb rate');
  validatePositive(descentRateFpm, 'Descent rate');
  validatePositive(climbGroundSpeedKt, 'Climb groundspeed');
  validatePositive(descentGroundSpeedKt, 'Descent groundspeed');

  const routeDistanceNm = totalRouteDistanceNm(legs);
  const climbAltitudeGainFt = Math.max(0, initialPlannedAltitudeFt - departureElevationFt);
  const descentAltitudeLossFt = Math.max(0, finalPlannedAltitudeFt - destinationElevationFt);
  const climbTimeMin = climbAltitudeGainFt / climbRateFpm;
  const descentTimeMin = descentAltitudeLossFt / descentRateFpm;
  const climbDistanceNm = climbGroundSpeedKt * (climbTimeMin / 60);
  const descentDistanceNm = descentGroundSpeedKt * (descentTimeMin / 60);
  const tocDistanceFromDepartureNm = climbDistanceNm;
  const todDistanceFromDepartureNm = routeDistanceNm - descentDistanceNm;
  const profilesOverlap = climbDistanceNm + descentDistanceNm > routeDistanceNm;
  const overlapDistanceNm = Math.max(0, climbDistanceNm + descentDistanceNm - routeDistanceNm);
  const levelDistanceNm = Math.max(0, todDistanceFromDepartureNm - tocDistanceFromDepartureNm);
  const tocOnRoute = tocDistanceFromDepartureNm >= 0 && tocDistanceFromDepartureNm <= routeDistanceNm;
  const todOnRoute = todDistanceFromDepartureNm >= 0 && todDistanceFromDepartureNm <= routeDistanceNm;

  return {
    routeDistanceNm,
    climbAltitudeGainFt,
    descentAltitudeLossFt,
    climbTimeMin,
    descentTimeMin,
    climbDistanceNm,
    descentDistanceNm,
    tocDistanceFromDepartureNm,
    todDistanceFromDepartureNm,
    todDistanceToDestinationNm: descentDistanceNm,
    levelDistanceNm,
    profilesOverlap,
    overlapDistanceNm,
    tocOnRoute,
    todOnRoute,
    tocCoordinate: climbAltitudeGainFt > 0 && tocOnRoute ? routeCoordinateAtDistance(legs, tocDistanceFromDepartureNm) : null,
    todCoordinate: descentAltitudeLossFt > 0 && todOnRoute ? routeCoordinateAtDistance(legs, todDistanceFromDepartureNm) : null,
  };
}

export function routeCoordinateAtDistance(legs: RouteLeg[], distanceFromDepartureNm: number): Coordinate | null {
  if (legs.length === 0 || !Number.isFinite(distanceFromDepartureNm)) return null;
  const routeDistanceNm = totalRouteDistanceNm(legs);
  const target = Math.min(routeDistanceNm, Math.max(0, distanceFromDepartureNm));
  let accumulated = 0;

  for (const leg of legs) {
    const legEnd = accumulated + leg.distanceNm;
    if (target <= legEnd || leg === legs[legs.length - 1]) {
      const fraction = leg.distanceNm <= 1e-9 ? 0 : (target - accumulated) / leg.distanceNm;
      return interpolateGreatCircle(leg.from, leg.to, Math.min(1, Math.max(0, fraction)));
    }
    accumulated = legEnd;
  }

  const last = legs[legs.length - 1].to;
  return { lat: last.lat, lon: last.lon };
}

function walkPhaseForward(
  legs: RouteLeg[],
  cumulative: number[],
  legWinds: Array<VerticalLegWind | null>,
  startNm: number,
  timeMin: number,
  tasKt: number,
): PhaseWalkResult {
  let remainingMin = Math.max(0, timeMin);
  let positionNm = startNm;
  const initialNm = startNm;

  for (let i = 0; i < legs.length && remainingMin > EPSILON; i += 1) {
    const legStart = cumulative[i];
    const legEnd = cumulative[i + 1];
    if (positionNm >= legEnd - EPSILON) continue;
    if (positionNm < legStart) positionNm = legStart;
    const availableNm = Math.max(0, legEnd - positionNm);
    if (availableNm <= EPSILON) continue;
    const gsKt = phaseGroundSpeedKt(legs[i], legWinds[i], tasKt);
    const availableMin = availableNm / gsKt * 60;
    if (remainingMin <= availableMin + EPSILON) {
      positionNm += gsKt * remainingMin / 60;
      remainingMin = 0;
      break;
    }
    positionNm = legEnd;
    remainingMin -= availableMin;
  }

  if (remainingMin > EPSILON) {
    const lastIndex = legs.length - 1;
    const gsKt = phaseGroundSpeedKt(legs[lastIndex], legWinds[lastIndex], tasKt);
    positionNm += gsKt * remainingMin / 60;
  }

  return { routeDistanceNm: positionNm, groundDistanceNm: Math.max(0, positionNm - initialNm) };
}

function walkPhaseBackward(
  legs: RouteLeg[],
  cumulative: number[],
  legWinds: Array<VerticalLegWind | null>,
  endNm: number,
  timeMin: number,
  tasKt: number,
): PhaseWalkResult {
  let remainingMin = Math.max(0, timeMin);
  let positionNm = endNm;
  const initialNm = endNm;

  for (let i = legs.length - 1; i >= 0 && remainingMin > EPSILON; i -= 1) {
    const legStart = cumulative[i];
    const legEnd = cumulative[i + 1];
    if (positionNm <= legStart + EPSILON) continue;
    if (positionNm > legEnd) positionNm = legEnd;
    const availableNm = Math.max(0, positionNm - legStart);
    if (availableNm <= EPSILON) continue;
    const gsKt = phaseGroundSpeedKt(legs[i], legWinds[i], tasKt);
    const availableMin = availableNm / gsKt * 60;
    if (remainingMin <= availableMin + EPSILON) {
      positionNm -= gsKt * remainingMin / 60;
      remainingMin = 0;
      break;
    }
    positionNm = legStart;
    remainingMin -= availableMin;
  }

  if (remainingMin > EPSILON) {
    const gsKt = phaseGroundSpeedKt(legs[0], legWinds[0], tasKt);
    positionNm -= gsKt * remainingMin / 60;
  }

  return { routeDistanceNm: positionNm, groundDistanceNm: Math.max(0, initialNm - positionNm) };
}

function phaseGroundSpeedKt(leg: RouteLeg, wind: VerticalLegWind | null | undefined, tasKt: number): number {
  if (!wind || wind.windSpeedKt <= EPSILON) return tasKt;
  return solveWindTriangle({
    trueTrackDeg: leg.trueTrackDeg,
    tasKt,
    windFromDeg: wind.windFromDeg,
    windSpeedKt: wind.windSpeedKt,
  }).groundSpeedKt;
}

function cumulativeWaypointDistances(legs: RouteLeg[]): number[] {
  const distances = [0];
  let accumulated = 0;
  for (const leg of legs) {
    accumulated += leg.distanceNm;
    distances.push(accumulated);
  }
  return distances;
}

function intervalUnionDistance(intervals: VerticalInterval[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.startNm - b.startNm || a.endNm - b.endNm);
  let union = 0;
  let currentStart = sorted[0].startNm;
  let currentEnd = sorted[0].endNm;

  for (const interval of sorted.slice(1)) {
    if (interval.startNm <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.endNm);
    } else {
      union += currentEnd - currentStart;
      currentStart = interval.startNm;
      currentEnd = interval.endNm;
    }
  }
  return union + currentEnd - currentStart;
}

function interpolateGreatCircle(a: Coordinate, b: Coordinate, fraction: number): Coordinate {
  if (fraction <= 0) return { lat: a.lat, lon: a.lon };
  if (fraction >= 1) return { lat: b.lat, lon: b.lon };

  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const lat1 = a.lat * toRad;
  const lon1 = a.lon * toRad;
  const lat2 = b.lat * toRad;
  const lon2 = b.lon * toRad;
  const cosDelta = Math.min(
    1,
    Math.max(-1, Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)),
  );
  const delta = Math.acos(cosDelta);

  if (delta < 1e-10) return { lat: a.lat, lon: a.lon };

  const sinDelta = Math.sin(delta);
  const weightA = Math.sin((1 - fraction) * delta) / sinDelta;
  const weightB = Math.sin(fraction * delta) / sinDelta;
  const x = weightA * Math.cos(lat1) * Math.cos(lon1) + weightB * Math.cos(lat2) * Math.cos(lon2);
  const y = weightA * Math.cos(lat1) * Math.sin(lon1) + weightB * Math.cos(lat2) * Math.sin(lon2);
  const z = weightA * Math.sin(lat1) + weightB * Math.sin(lat2);

  return {
    lat: Math.atan2(z, Math.hypot(x, y)) * toDeg,
    lon: Math.atan2(y, x) * toDeg,
  };
}

function validatePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero.`);
}

function validateFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} cannot be negative.`);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function roundHalfNm(value: number): string {
  return (Math.round(value * 2) / 2).toFixed(1);
}