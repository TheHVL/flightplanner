import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { getFuelPlanningSettings, saveFuelPlanningSettings } from '../fuel/fuelPlanning';

/** User-supplied school planning settings, not a replacement POH performance table. */
export const SCHOOL_C182T = {
  cruiseRpm: 2200, cruiseMp: 20,
  climbKias: 90, climbRpm: 2400, climbMp: 23, climbRateFpm: 500,
  descentMp: 18, descentRateFpm: 700, descentFuelFlowGph: 10,
  patternFuelFlowGph: 12, startupTaxiTakeoffGal: 2, reserveGal: 12,
} as const;

export const SCHOOL_PRESET_DESCRIPTION = 'Cruise 2200 RPM / 20 inHg. Climb 90 KIAS, 2400 RPM / 23 inHg at 500 ft/min for planning (reported range 500-1000). Descent at cruise TAS, about 18 inHg, 700 ft/min and 10 US gal/h. Pattern 12 US gal/h. Start/taxi/takeoff 2 US gal. Reserve 12 US gal. Contingency is entered manually for each flight. Climb fuel flow still needs confirmation.';

export function applySchoolAircraftSettings(store: FlightPlanStore): void {
  store.updatePerformanceSettings({ usePohPerformance: true, rpm: SCHOOL_C182T.cruiseRpm, manifoldPressureInHg: SCHOOL_C182T.cruiseMp });
  store.updateVerticalProfileSettings({ climbRateFpm: SCHOOL_C182T.climbRateFpm, climbGroundSpeedKt: SCHOOL_C182T.climbKias,
    climbSpeedMode: 'ias', descentRateFpm: SCHOOL_C182T.descentRateFpm, descentSpeedMode: 'cruise' });
}

export function applySchoolPreset(store: FlightPlanStore): void {
  // Save before changing the route's settings in case browser storage is unavailable.
  saveFuelPlanningSettings({ ...getFuelPlanningSettings(), climbPerformanceMode: 'manual', climbFuelFlowGph: null,
    startupTaxiTakeoffGal: SCHOOL_C182T.startupTaxiTakeoffGal, descentFuelFlowGph: SCHOOL_C182T.descentFuelFlowGph,
    circuitFuelFlowGph: SCHOOL_C182T.patternFuelFlowGph, reserveGal: SCHOOL_C182T.reserveGal });
  applySchoolAircraftSettings(store);
}
