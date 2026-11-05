import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { getFuelPlanningSettings, saveFuelPlanningSettings } from '../fuel/fuelPlanning';

/** User-supplied school planning settings, not a replacement POH performance table. */
export const SCHOOL_C182T = {
  cruiseRpm: 2200, cruiseMp: 20,
  climbKias: 90, climbRpm: 2400, climbMp: 23, climbRateFpm: 500,
  climbFuelFlowGph: 12,
  descentMp: 18, descentRateFpm: 500,
  // Retained only for the shelved generator's legacy numeric input.
  descentFuelFlowGph: 10,
  patternFuelFlowGph: 12, startupTaxiTakeoffGal: 2, reserveGal: 12,
} as const;

export const SCHOOL_PRESET_DESCRIPTION = 'Cruise 2200 RPM / 20 inHg. Climb 90 KIAS, 2400 RPM / 23 inHg and 12 US gal/h; 500 ft/min is an editable planning reference, not a rate implied by airspeed. Descent at cruise TAS and cruise fuel flow, about 18 inHg, with an editable 500 ft/min default. Pattern 12 US gal/h. Start/taxi/takeoff 2 US gal. Reserve 12 US gal. Contingency is entered manually for each flight.';

export function applySchoolAircraftSettings(store: FlightPlanStore): void {
  store.updatePerformanceSettings({ usePohPerformance: true, rpm: SCHOOL_C182T.cruiseRpm, manifoldPressureInHg: SCHOOL_C182T.cruiseMp });
  store.updateVerticalProfileSettings({ climbRateFpm: SCHOOL_C182T.climbRateFpm, climbGroundSpeedKt: SCHOOL_C182T.climbKias,
    climbSpeedMode: 'ias', descentRateFpm: SCHOOL_C182T.descentRateFpm, descentSpeedMode: 'cruise' });
}

export function applySchoolPreset(store: FlightPlanStore): void {
  // Save before changing the route's settings in case browser storage is unavailable.
  saveFuelPlanningSettings({ ...getFuelPlanningSettings(), climbPerformanceMode: 'manual', climbFuelFlowGph: SCHOOL_C182T.climbFuelFlowGph,
    startupTaxiTakeoffGal: SCHOOL_C182T.startupTaxiTakeoffGal, descentFuelFlowMode: 'cruise',
    circuitFuelFlowGph: SCHOOL_C182T.patternFuelFlowGph, reserveGal: SCHOOL_C182T.reserveGal });
  applySchoolAircraftSettings(store);
}
