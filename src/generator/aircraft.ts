import { DEFAULT_FUEL_PLANNING_SETTINGS, type FuelPlanningSettings } from '../fuel/fuelPlanning';
import { SCHOOL_C182T } from '../performance/schoolPreset';
import type { GeneratorRequest } from './candidates';

/** Same assumptions for scoring, terrain profile, preview and transferred plan. */
export function generatorFuelSettings(request: GeneratorRequest): FuelPlanningSettings {
  return { ...DEFAULT_FUEL_PLANNING_SETTINGS,
    ...(request.schoolPreset ? { climbPerformanceMode: 'manual' as const,
      climbFuelFlowGph: request.climbFuelFlowGph ?? null,
      startupTaxiTakeoffGal: SCHOOL_C182T.startupTaxiTakeoffGal, reserveGal: SCHOOL_C182T.reserveGal } : {}),
    descentFuelFlowGph: request.descentFuelFlowGph, circuitFuelFlowGph: request.patternFuelFlowGph };
}
