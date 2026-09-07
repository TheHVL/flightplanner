import type {
  FlightPlanStore,
  LegWeatherForecast,
  NavigationSettings,
  PerformanceSettings,
  WeatherSettings,
} from '../flightplan/FlightPlanStore';
import type { RouteLeg } from '../types';
import { solveWindTriangle } from '../navigation/wind';
import {
  calculateRouteVerticalProfile,
  type ClimbPerformanceMode,
  type RouteVerticalEvent,
  type RouteVerticalProfileResult,
} from '../navigation/verticalProfile';
import { calculateCruisePerformance } from '../performance/cruisePerformance';

export const FUEL_SETTINGS_CHANGED_EVENT = 'flightplanner-fuel-settings-changed';
const STORAGE_KEY = 'flightplanner-fuel-settings-v1';
const EPSILON = 1e-6;

export interface FuelPlanningSettings {
  startupTaxiTakeoffGal: number;
  manualCruiseFuelFlowGph: number | null;
  climbPerformanceMode: ClimbPerformanceMode;
  climbFuelFlowGph: number | null;
  descentFuelFlowGph: number | null;
  circuitFuelFlowGph: number | null;
  totalFuelOnboardGal: number | null;
}

export interface FuelLegPlan {
  fromId: string;
  toId: string;
  pressureAltitudeFt: number;
  oatC: number;
  oatSource: 'forecast' | 'manual';
  tasKt: number;
  windFromDeg: number;
  windSpeedKt: number;
  forecastWindActive: boolean;
  groundSpeedKt: number;
  wcaDeg: number;
  trueHeadingDeg: number;
  cruiseFuelFlowGph: number | null;
  cruiseDistanceNm: number;
  climbDistanceNm: number;
  descentDistanceNm: number;
  cruiseTimeMin: number;
  climbTimeMin: number;
  descentTimeMin: number;
  activityTimeMin: number;
  totalTimeMin: number;
  cruiseFuelGal: number | null;
  climbFuelGal: number | null;
  descentFuelGal: number | null;
  circuitFuelGal: number | null;
  legFuelGal: number | null;
  performanceError: string | null;
  phaseWarning: string | null;
}

export interface RouteFuelPlan {
  legs: FuelLegPlan[];
  startupTaxiTakeoffGal: number;
  cruiseFuelGal: number | null;
  climbFuelGal: number | null;
  descentFuelGal: number | null;
  circuitFuelGal: number | null;
  enrouteFuelGal: number | null;
  tripFuelGal: number | null;
  totalFuelOnboardGal: number | null;
  landingFuelGal: number | null;
  warnings: string[];
  verticalProfile: RouteVerticalProfileResult | null;
}

interface RouteFuelPlanInput {
  legs: RouteLeg[];
  plannedAltitudesFt: Array<number | null>;
  forecasts: Array<LegWeatherForecast | null>;
  waypointActivityMinutes: number[];
  navigationSettings: NavigationSettings;
  performanceSettings: PerformanceSettings;
  weatherSettings: WeatherSettings;
  verticalProfile: RouteVerticalProfileResult | null;
  fuelSettings: FuelPlanningSettings;
}

interface VerticalSegment {
  phase: 'climb' | 'descent';
  startNm: number;
  endNm: number;
  timeMin: number;
  fuelGal: number | null;
}

interface LegVerticalPhase {
  climbDistanceNm: number;
  descentDistanceNm: number;
  climbTimeMin: number;
  descentTimeMin: number;
  pohClimbFuelGal: number;
  pohClimbFuelComplete: boolean;
}

export const DEFAULT_FUEL_PLANNING_SETTINGS: FuelPlanningSettings = {
  // UiT OFP v4.2 states Trip Fuel includes 1.7 US gal for startup, taxi and takeoff.
  startupTaxiTakeoffGal: 1.7,
  manualCruiseFuelFlowGph: null,
  // Figure 5-8 Sheet 2 is the normal-climb table at 90 KIAS and is the default planning profile.
  climbPerformanceMode: 'poh-normal-90',
  climbFuelFlowGph: null,
  descentFuelFlowGph: null,
  circuitFuelFlowGph: null,
  totalFuelOnboardGal: null,
};

export function getFuelPlanningSettings(): FuelPlanningSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_FUEL_PLANNING_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FUEL_PLANNING_SETTINGS };
    return sanitizeSettings({ ...DEFAULT_FUEL_PLANNING_SETTINGS, ...JSON.parse(raw) });
  } catch {
    return { ...DEFAULT_FUEL_PLANNING_SETTINGS };
  }
}

export function saveFuelPlanningSettings(settings: FuelPlanningSettings): FuelPlanningSettings {
  const sanitized = sanitizeSettings(settings);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    window.dispatchEvent(new CustomEvent(FUEL_SETTINGS_CHANGED_EVENT));
  }
  return sanitized;
}

export function calculateFuelPlanForStore(
  store: FlightPlanStore,
  fuelSettings: FuelPlanningSettings = getFuelPlanningSettings(),
): RouteFuelPlan {
  const legs = store.getLegs();
  const performanceSettings = store.getPerformanceSettings();
  let verticalProfile: RouteVerticalProfileResult | null = null;
  if (legs.length > 0) {
    try {
      verticalProfile = calculateRouteVerticalProfile({
        legs,
        plannedAltitudesFt: legs.map((leg) => store.getPlannedAltitudeFt(leg.from.id, leg.to.id)),
        waypointConstraints: store.getVerticalWaypointConstraints(),
        ...store.getVerticalProfileSettings(),
        climbPerformanceMode: fuelSettings.climbPerformanceMode,
        climbOatC: performanceSettings.oatC,
      });
    } catch {
      verticalProfile = null;
    }
  }

  return calculateRouteFuelPlan({
    legs,
    plannedAltitudesFt: legs.map((leg) => store.getPlannedAltitudeFt(leg.from.id, leg.to.id)),
    forecasts: legs.map((leg) => store.getLegWeatherForecast(leg.from.id, leg.to.id)),
    waypointActivityMinutes: legs.map((leg, index) => index > 0 ? store.getWaypointActivityMinutes(leg.from.id) : 0),
    navigationSettings: store.getNavigationSettings(),
    performanceSettings,
    weatherSettings: store.getWeatherSettings(),
    verticalProfile,
    fuelSettings,
  });
}

export function calculateRouteFuelPlan(input: RouteFuelPlanInput): RouteFuelPlan {
  const {
    legs,
    plannedAltitudesFt,
    forecasts,
    waypointActivityMinutes,
    navigationSettings,
    performanceSettings,
    weatherSettings,
    verticalProfile,
    fuelSettings,
  } = input;

  if (
    plannedAltitudesFt.length !== legs.length ||
    forecasts.length !== legs.length ||
    waypointActivityMinutes.length !== legs.length
  ) {
    throw new Error('Fuel-planning leg data does not match the route.');
  }

  const warnings: string[] = [];
  const profilesOverlap = verticalProfile?.profilesOverlap ?? false;
  const climbPerformanceIncomplete = verticalProfile?.climbPerformanceIncomplete ?? false;
  const phaseModelAvailable = verticalProfile !== null && !profilesOverlap && !climbPerformanceIncomplete;
  if (profilesOverlap) {
    warnings.push('Vertical profiles overlap, so climb/descent fuel and complete trip-fuel totals are withheld until the profile is resolved.');
  }
  if (climbPerformanceIncomplete) {
    warnings.push('Selected POH climb data does not cover one or more requested climbs, so complete trip-fuel totals are withheld.');
  }
  const segments = phaseModelAvailable ? verticalSegments(verticalProfile!, legs) : [];
  const cumulativeDistances = cumulativeLegDistances(legs);

  const legPlans = legs.map((leg, index): FuelLegPlan => {
    const forecast = forecasts[index];
    const forecastWindActive = weatherSettings.useForecastWinds && forecast !== null;
    const windFromDeg = forecastWindActive ? forecast!.windFromDeg : navigationSettings.windFromDeg;
    const windSpeedKt = forecastWindActive ? forecast!.windSpeedKt : navigationSettings.windSpeedKt;
    const plannedAltitudeFt = plannedAltitudesFt[index];
    const pressureAltitudeFt = plannedAltitudeFt ?? performanceSettings.pressureAltitudeFt;
    const oatC = forecast?.temperatureC ?? performanceSettings.oatC;
    const oatSource: 'forecast' | 'manual' = forecast ? 'forecast' : 'manual';

    if (plannedAltitudeFt === null && performanceSettings.usePohPerformance) {
      warnings.push(`${leg.from.name} -> ${leg.to.name}: no PL entered, so the Phase 4 pressure-altitude field is used for cruise performance.`);
    }

    let tasKt = navigationSettings.tasKt;
    let cruiseFuelFlowGph: number | null = performanceSettings.usePohPerformance
      ? null
      : fuelSettings.manualCruiseFuelFlowGph;
    let performanceError: string | null = null;

    if (performanceSettings.usePohPerformance) {
      try {
        const performance = calculateCruisePerformance({
          pressureAltitudeFt,
          oatC,
          rpm: performanceSettings.rpm,
          manifoldPressureInHg: performanceSettings.manifoldPressureInHg,
        });
        tasKt = performance.ktas;
        cruiseFuelFlowGph = performance.fuelFlowGph;
      } catch (error) {
        performanceError = error instanceof Error ? error.message : 'POH cruise performance could not be calculated.';
      }
    }

    const wind = performanceError === null
      ? solveWindTriangle({
          trueTrackDeg: leg.trueTrackDeg,
          tasKt,
          windFromDeg,
          windSpeedKt,
        })
      : null;

    const legStartNm = cumulativeDistances[index];
    const legEndNm = cumulativeDistances[index + 1];
    const phase: LegVerticalPhase = phaseModelAvailable
      ? phaseForLeg(segments, legStartNm, legEndNm)
      : {
          climbDistanceNm: 0,
          descentDistanceNm: 0,
          climbTimeMin: 0,
          descentTimeMin: 0,
          pohClimbFuelGal: 0,
          pohClimbFuelComplete: false,
        };
    const cruiseDistanceNm = Math.max(0, leg.distanceNm - phase.climbDistanceNm - phase.descentDistanceNm);
    const cruiseTimeMin = wind ? cruiseDistanceNm / wind.groundSpeedKt * 60 : 0;
    const activityTimeMin = Math.max(0, waypointActivityMinutes[index]);
    const totalTimeMin = cruiseTimeMin + phase.climbTimeMin + phase.descentTimeMin + activityTimeMin;

    const cruiseFuelGal = phaseFuel(cruiseTimeMin, cruiseFuelFlowGph);
    const climbFuelGal = profilesOverlap || climbPerformanceIncomplete
      ? null
      : phase.climbTimeMin <= EPSILON
        ? 0
        : phase.pohClimbFuelComplete
          ? phase.pohClimbFuelGal
          : phaseFuel(phase.climbTimeMin, fuelSettings.climbFuelFlowGph);
    const descentFuelGal = profilesOverlap || climbPerformanceIncomplete
      ? null
      : phaseFuel(phase.descentTimeMin, fuelSettings.descentFuelFlowGph);
    const circuitFuelGal = phaseFuel(activityTimeMin, fuelSettings.circuitFuelFlowGph);
    const legFuelGal = profilesOverlap || climbPerformanceIncomplete
      ? null
      : sumIfKnown([cruiseFuelGal, climbFuelGal, descentFuelGal, circuitFuelGal]);

    const missingPhases: string[] = [];
    if (cruiseTimeMin > EPSILON && cruiseFuelFlowGph === null) missingPhases.push('cruise FF');
    if (phase.climbTimeMin > EPSILON && !phase.pohClimbFuelComplete && fuelSettings.climbFuelFlowGph === null) missingPhases.push('climb FF');
    if (phase.descentTimeMin > EPSILON && fuelSettings.descentFuelFlowGph === null) missingPhases.push('descent FF');
    if (activityTimeMin > EPSILON && fuelSettings.circuitFuelFlowGph === null) missingPhases.push('circuit FF');
    const phaseWarning = profilesOverlap
      ? 'Vertical profiles overlap, so phase-aware climb/descent fuel is unavailable.'
      : climbPerformanceIncomplete
        ? 'Selected POH climb profile does not cover the requested climb.'
        : missingPhases.length > 0
          ? `Enter ${missingPhases.join(', ')} to complete fuel for this leg.`
          : null;

    return {
      fromId: leg.from.id,
      toId: leg.to.id,
      pressureAltitudeFt,
      oatC,
      oatSource,
      tasKt,
      windFromDeg,
      windSpeedKt,
      forecastWindActive,
      groundSpeedKt: wind?.groundSpeedKt ?? 0,
      wcaDeg: wind?.wcaDeg ?? 0,
      trueHeadingDeg: wind?.trueHeadingDeg ?? leg.trueTrackDeg,
      cruiseFuelFlowGph,
      cruiseDistanceNm,
      climbDistanceNm: phase.climbDistanceNm,
      descentDistanceNm: phase.descentDistanceNm,
      cruiseTimeMin,
      climbTimeMin: phase.climbTimeMin,
      descentTimeMin: phase.descentTimeMin,
      activityTimeMin,
      totalTimeMin,
      cruiseFuelGal,
      climbFuelGal,
      descentFuelGal,
      circuitFuelGal,
      legFuelGal,
      performanceError,
      phaseWarning,
    };
  });

  const routeFuelIncomplete = profilesOverlap || climbPerformanceIncomplete;
  const cruiseFuelGal = sumComponent(legPlans.map((leg) => leg.cruiseFuelGal));
  const climbFuelGal = routeFuelIncomplete ? null : sumComponent(legPlans.map((leg) => leg.climbFuelGal));
  const descentFuelGal = routeFuelIncomplete ? null : sumComponent(legPlans.map((leg) => leg.descentFuelGal));
  const circuitFuelGal = sumComponent(legPlans.map((leg) => leg.circuitFuelGal));
  const enrouteFuelGal = routeFuelIncomplete ? null : sumComponent(legPlans.map((leg) => leg.legFuelGal));
  const tripFuelGal = enrouteFuelGal === null
    ? null
    : fuelSettings.startupTaxiTakeoffGal + enrouteFuelGal;
  const landingFuelGal = fuelSettings.totalFuelOnboardGal !== null && tripFuelGal !== null
    ? fuelSettings.totalFuelOnboardGal - tripFuelGal
    : null;

  for (const [index, leg] of legPlans.entries()) {
    if (leg.performanceError) {
      const routeLeg = legs[index];
      warnings.push(`${routeLeg.from.name} -> ${routeLeg.to.name}: ${leg.performanceError}`);
    }
    if (leg.phaseWarning) warnings.push(leg.phaseWarning);
  }

  if (performanceSettings.usePohPerformance) {
    warnings.push('Per-leg PL is currently used as a pressure-altitude proxy for Figure 5-9. A future QNH conversion can refine this.');
  }
  if (fuelSettings.climbPerformanceMode !== 'manual') {
    warnings.push('POH Figure 5-8 climb calculations use entered elevation/PL as pressure-altitude proxies. Distance is the POH zero-wind distance.');
    warnings.push('Figure 5-8 temperature correction currently uses the Phase 4 OAT field at the target climb altitude, increasing time, fuel and distance only when above ISA.');
  }
  if (legPlans.some((leg) => leg.oatSource === 'manual')) {
    warnings.push('Where no route-weather temperature is available, the Phase 4 OAT field is used as the cruise-temperature fallback.');
  }

  return {
    legs: legPlans,
    startupTaxiTakeoffGal: fuelSettings.startupTaxiTakeoffGal,
    cruiseFuelGal,
    climbFuelGal,
    descentFuelGal,
    circuitFuelGal,
    enrouteFuelGal,
    tripFuelGal,
    totalFuelOnboardGal: fuelSettings.totalFuelOnboardGal,
    landingFuelGal,
    warnings: unique(warnings),
    verticalProfile,
  };
}

function verticalSegments(profile: RouteVerticalProfileResult, legs: RouteLeg[]): VerticalSegment[] {
  const routeDistanceNm = legs.reduce((sum, leg) => sum + leg.distanceNm, 0);
  return profile.events
    .map((event) => segmentFromEvent(event, routeDistanceNm))
    .filter((segment): segment is VerticalSegment => segment !== null);
}

function segmentFromEvent(event: RouteVerticalEvent, routeDistanceNm: number): VerticalSegment | null {
  if (event.distanceNm <= EPSILON || event.timeMin <= EPSILON) return null;
  const rawStartNm = event.type === 'TOC'
    ? event.routeDistanceNm - event.distanceNm
    : event.routeDistanceNm;
  const rawEndNm = event.type === 'TOC'
    ? event.routeDistanceNm
    : event.routeDistanceNm + event.distanceNm;
  const startNm = Math.max(0, Math.min(routeDistanceNm, rawStartNm));
  const endNm = Math.max(0, Math.min(routeDistanceNm, rawEndNm));
  const clippedDistanceNm = Math.max(0, endNm - startNm);
  if (clippedDistanceNm <= EPSILON) return null;
  const fraction = clippedDistanceNm / event.distanceNm;
  return {
    phase: event.type === 'TOC' ? 'climb' : 'descent',
    startNm,
    endNm,
    timeMin: event.timeMin * fraction,
    fuelGal: event.fuelGal === null ? null : event.fuelGal * fraction,
  };
}

function phaseForLeg(segments: VerticalSegment[], legStartNm: number, legEndNm: number): LegVerticalPhase {
  let climbDistanceNm = 0;
  let descentDistanceNm = 0;
  let climbTimeMin = 0;
  let descentTimeMin = 0;
  let pohClimbFuelGal = 0;
  let pohClimbFuelComplete = true;

  for (const segment of segments) {
    const overlapNm = overlapLength(segment.startNm, segment.endNm, legStartNm, legEndNm);
    if (overlapNm <= EPSILON) continue;
    const segmentDistanceNm = segment.endNm - segment.startNm;
    const overlapFraction = overlapNm / segmentDistanceNm;
    const overlapTimeMin = segment.timeMin * overlapFraction;
    if (segment.phase === 'climb') {
      climbDistanceNm += overlapNm;
      climbTimeMin += overlapTimeMin;
      if (segment.fuelGal === null) {
        pohClimbFuelComplete = false;
      } else {
        pohClimbFuelGal += segment.fuelGal * overlapFraction;
      }
    } else {
      descentDistanceNm += overlapNm;
      descentTimeMin += overlapTimeMin;
    }
  }

  if (climbTimeMin <= EPSILON) pohClimbFuelComplete = true;
  return {
    climbDistanceNm,
    descentDistanceNm,
    climbTimeMin,
    descentTimeMin,
    pohClimbFuelGal,
    pohClimbFuelComplete,
  };
}

function cumulativeLegDistances(legs: RouteLeg[]): number[] {
  const result = [0];
  for (const leg of legs) result.push(result[result.length - 1] + leg.distanceNm);
  return result;
}

function overlapLength(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function phaseFuel(timeMin: number, fuelFlowGph: number | null): number | null {
  if (timeMin <= EPSILON) return 0;
  return fuelFlowGph === null ? null : fuelFlowGph * timeMin / 60;
}

function sumIfKnown(values: Array<number | null>): number | null {
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function sumComponent(values: Array<number | null>): number | null {
  return sumIfKnown(values);
}

function sanitizeSettings(settings: FuelPlanningSettings): FuelPlanningSettings {
  return {
    startupTaxiTakeoffGal: boundedNumber(settings.startupTaxiTakeoffGal, 0, 20, 1.7),
    manualCruiseFuelFlowGph: nullableBoundedNumber(settings.manualCruiseFuelFlowGph, 0, 40),
    climbPerformanceMode: sanitizeClimbPerformanceMode(settings.climbPerformanceMode),
    climbFuelFlowGph: nullableBoundedNumber(settings.climbFuelFlowGph, 0, 40),
    descentFuelFlowGph: nullableBoundedNumber(settings.descentFuelFlowGph, 0, 40),
    circuitFuelFlowGph: nullableBoundedNumber(settings.circuitFuelFlowGph, 0, 40),
    totalFuelOnboardGal: nullableBoundedNumber(settings.totalFuelOnboardGal, 0, 100),
  };
}

function sanitizeClimbPerformanceMode(value: ClimbPerformanceMode): ClimbPerformanceMode {
  return value === 'manual' || value === 'poh-max-rate' || value === 'poh-normal-90'
    ? value
    : DEFAULT_FUEL_PLANNING_SETTINGS.climbPerformanceMode;
}

function boundedNumber(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function nullableBoundedNumber(value: number | null, min: number, max: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
