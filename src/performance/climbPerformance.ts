export type C182TClimbProfile = 'normal-90' | 'max-rate';

interface ClimbTablePoint {
  pressureAltitudeFt: number;
  climbSpeedKias: number;
  rateOfClimbFpm: number;
  timeFromSeaLevelMin: number;
  fuelFromSeaLevelGal: number;
  distanceFromSeaLevelNm: number;
}

export interface C182TClimbResult {
  profile: C182TClimbProfile;
  startPressureAltitudeFt: number;
  endPressureAltitudeFt: number;
  targetClimbSpeedKias: number;
  targetRateOfClimbFpm: number;
  timeMin: number;
  fuelUsedGal: number;
  distanceNm: number;
  temperatureAboveStandardC: number;
  temperatureCorrectionFactor: number;
}

export interface C182TClimbInput {
  profile: C182TClimbProfile;
  startPressureAltitudeFt: number;
  endPressureAltitudeFt: number;
  oatC?: number | null;
}

const MAX_RATE: ClimbTablePoint[] = [
  { pressureAltitudeFt: 0, climbSpeedKias: 80, rateOfClimbFpm: 925, timeFromSeaLevelMin: 0, fuelFromSeaLevelGal: 0, distanceFromSeaLevelNm: 0 },
  { pressureAltitudeFt: 2000, climbSpeedKias: 79, rateOfClimbFpm: 835, timeFromSeaLevelMin: 2, fuelFromSeaLevelGal: 0.8, distanceFromSeaLevelNm: 3 },
  { pressureAltitudeFt: 4000, climbSpeedKias: 78, rateOfClimbFpm: 750, timeFromSeaLevelMin: 5, fuelFromSeaLevelGal: 1.5, distanceFromSeaLevelNm: 7 },
  { pressureAltitudeFt: 6000, climbSpeedKias: 77, rateOfClimbFpm: 660, timeFromSeaLevelMin: 8, fuelFromSeaLevelGal: 2.3, distanceFromSeaLevelNm: 11 },
  { pressureAltitudeFt: 8000, climbSpeedKias: 75, rateOfClimbFpm: 565, timeFromSeaLevelMin: 11, fuelFromSeaLevelGal: 3.2, distanceFromSeaLevelNm: 16 },
  { pressureAltitudeFt: 10000, climbSpeedKias: 74, rateOfClimbFpm: 470, timeFromSeaLevelMin: 15, fuelFromSeaLevelGal: 4.2, distanceFromSeaLevelNm: 21 },
  { pressureAltitudeFt: 12000, climbSpeedKias: 73, rateOfClimbFpm: 375, timeFromSeaLevelMin: 20, fuelFromSeaLevelGal: 5.2, distanceFromSeaLevelNm: 29 },
  { pressureAltitudeFt: 14000, climbSpeedKias: 72, rateOfClimbFpm: 285, timeFromSeaLevelMin: 26, fuelFromSeaLevelGal: 6.5, distanceFromSeaLevelNm: 38 },
];

const NORMAL_90: ClimbTablePoint[] = [
  { pressureAltitudeFt: 0, climbSpeedKias: 90, rateOfClimbFpm: 665, timeFromSeaLevelMin: 0, fuelFromSeaLevelGal: 0, distanceFromSeaLevelNm: 0 },
  { pressureAltitudeFt: 2000, climbSpeedKias: 90, rateOfClimbFpm: 625, timeFromSeaLevelMin: 3, fuelFromSeaLevelGal: 0.8, distanceFromSeaLevelNm: 5 },
  { pressureAltitudeFt: 4000, climbSpeedKias: 90, rateOfClimbFpm: 580, timeFromSeaLevelMin: 6, fuelFromSeaLevelGal: 1.6, distanceFromSeaLevelNm: 10 },
  { pressureAltitudeFt: 6000, climbSpeedKias: 90, rateOfClimbFpm: 540, timeFromSeaLevelMin: 10, fuelFromSeaLevelGal: 2.5, distanceFromSeaLevelNm: 16 },
  { pressureAltitudeFt: 8000, climbSpeedKias: 90, rateOfClimbFpm: 455, timeFromSeaLevelMin: 14, fuelFromSeaLevelGal: 3.5, distanceFromSeaLevelNm: 23 },
  { pressureAltitudeFt: 10000, climbSpeedKias: 90, rateOfClimbFpm: 370, timeFromSeaLevelMin: 19, fuelFromSeaLevelGal: 4.6, distanceFromSeaLevelNm: 31 },
];

export function calculateC182TClimb(input: C182TClimbInput): C182TClimbResult {
  const { profile, startPressureAltitudeFt, endPressureAltitudeFt, oatC = null } = input;
  if (!Number.isFinite(startPressureAltitudeFt) || !Number.isFinite(endPressureAltitudeFt)) {
    throw new Error('Climb pressure altitudes must be finite numbers.');
  }
  if (startPressureAltitudeFt < 0 || endPressureAltitudeFt < 0) {
    throw new Error('Climb pressure altitude cannot be negative.');
  }
  if (endPressureAltitudeFt < startPressureAltitudeFt) {
    throw new Error('End pressure altitude must be at or above start pressure altitude.');
  }

  const table = profile === 'normal-90' ? NORMAL_90 : MAX_RATE;
  const maximumAltitudeFt = table[table.length - 1].pressureAltitudeFt;
  if (endPressureAltitudeFt > maximumAltitudeFt) {
    const label = profile === 'normal-90' ? 'Normal climb - 90 KIAS' : 'Maximum rate of climb';
    throw new Error(`${label} Figure 5-8 data is only published through ${maximumAltitudeFt.toLocaleString()} ft pressure altitude.`);
  }

  const start = interpolatePoint(table, startPressureAltitudeFt);
  const end = interpolatePoint(table, endPressureAltitudeFt);
  const temperatureAboveStandardC = oatC === null || !Number.isFinite(oatC)
    ? 0
    : Math.max(0, oatC - isaTemperatureC(endPressureAltitudeFt));
  // POH Figure 5-8 note: increase time, fuel and distance by 10% for each 10°C above standard.
  const temperatureCorrectionFactor = 1 + temperatureAboveStandardC / 100;

  return {
    profile,
    startPressureAltitudeFt,
    endPressureAltitudeFt,
    targetClimbSpeedKias: end.climbSpeedKias,
    targetRateOfClimbFpm: end.rateOfClimbFpm,
    timeMin: Math.max(0, end.timeFromSeaLevelMin - start.timeFromSeaLevelMin) * temperatureCorrectionFactor,
    fuelUsedGal: Math.max(0, end.fuelFromSeaLevelGal - start.fuelFromSeaLevelGal) * temperatureCorrectionFactor,
    distanceNm: Math.max(0, end.distanceFromSeaLevelNm - start.distanceFromSeaLevelNm) * temperatureCorrectionFactor,
    temperatureAboveStandardC,
    temperatureCorrectionFactor,
  };
}

export function c182tClimbMaximumAltitudeFt(profile: C182TClimbProfile): number {
  const table = profile === 'normal-90' ? NORMAL_90 : MAX_RATE;
  return table[table.length - 1].pressureAltitudeFt;
}

export function isaTemperatureC(pressureAltitudeFt: number): number {
  return 15 - 2 * (pressureAltitudeFt / 1000);
}

function interpolatePoint(table: ClimbTablePoint[], altitudeFt: number): ClimbTablePoint {
  const exact = table.find((point) => point.pressureAltitudeFt === altitudeFt);
  if (exact) return { ...exact };

  const upperIndex = table.findIndex((point) => point.pressureAltitudeFt > altitudeFt);
  if (upperIndex <= 0) throw new Error('Requested climb altitude is outside the published Figure 5-8 table.');
  const lower = table[upperIndex - 1];
  const upper = table[upperIndex];
  const fraction = (altitudeFt - lower.pressureAltitudeFt) / (upper.pressureAltitudeFt - lower.pressureAltitudeFt);

  return {
    pressureAltitudeFt: altitudeFt,
    climbSpeedKias: lerp(lower.climbSpeedKias, upper.climbSpeedKias, fraction),
    rateOfClimbFpm: lerp(lower.rateOfClimbFpm, upper.rateOfClimbFpm, fraction),
    timeFromSeaLevelMin: lerp(lower.timeFromSeaLevelMin, upper.timeFromSeaLevelMin, fraction),
    fuelFromSeaLevelGal: lerp(lower.fuelFromSeaLevelGal, upper.fuelFromSeaLevelGal, fraction),
    distanceFromSeaLevelNm: lerp(lower.distanceFromSeaLevelNm, upper.distanceFromSeaLevelNm, fraction),
  };
}

function lerp(a: number, b: number, fraction: number): number {
  return a + (b - a) * fraction;
}
