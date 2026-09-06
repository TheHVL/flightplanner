export interface CruisePerformanceInput {
  pressureAltitudeFt: number;
  oatC: number;
  rpm: number;
  manifoldPressureInHg: number;
}

export interface CruisePerformanceResult {
  percentMcp: number;
  ktas: number;
  fuelFlowGph: number;
  isaTemperatureC: number;
  temperatureOffsetC: number;
}

interface CruisePoint {
  altitudeFt: number;
  rpm: number;
  tempOffsetC: -20 | 0 | 20;
  mpInHg: number;
  percentMcp: number;
  ktas: number;
  gph: number;
}

export const CRUISE_PREVIEW_LIMITS = {
  minPressureAltitudeFt: 0,
  maxPressureAltitudeFt: 2000,
  minRpm: 2200,
  maxRpm: 2400,
  minTempOffsetC: -20,
  maxTempOffsetC: 20,
} as const;

const POINTS: CruisePoint[] = [
  // Cessna 182T NAV III, Figure 5-9, pressure altitude sea level.
  ...rows(0, 2400, -20, [[25,84,134,14.5],[24,79,132,13.6],[23,74,129,12.8],[22,69,126,12.1],[21,65,122,11.4],[20,60,118,10.7]]),
  ...rows(0, 2400, 0, [[25,81,136,14.0],[24,76,133,13.2],[23,71,130,12.4],[22,67,127,11.7],[21,62,122,11.1],[20,58,118,10.4]]),
  ...rows(0, 2400, 20, [[26,82,140,14.3],[25,78,138,13.5],[24,74,135,12.8],[23,69,131,12.1],[22,65,127,11.4],[21,60,123,10.8],[20,56,118,10.2]]),

  ...rows(0, 2300, -20, [[25,80,133,13.9],[24,76,130,13.2],[23,71,127,12.4],[22,67,124,11.7],[21,62,120,11.1],[20,58,116,10.4]]),
  ...rows(0, 2300, 0, [[26,82,137,14.2],[25,78,135,13.4],[24,73,132,12.7],[23,69,128,12.0],[22,65,124,11.4],[21,60,120,10.8],[20,56,116,10.2]]),
  ...rows(0, 2300, 20, [[27,84,141,14.5],[26,79,139,13.7],[25,75,136,13.0],[24,71,132,12.3],[23,67,129,11.7],[22,62,125,11.1],[21,58,121,10.5],[20,54,116,9.9]]),

  ...rows(0, 2200, -20, [[26,82,133,14.2],[25,77,131,13.4],[24,73,129,12.7],[23,69,126,12.0],[22,65,122,11.4],[21,60,118,10.8],[20,56,114,10.2]]),
  ...rows(0, 2200, 0, [[27,83,137,14.4],[26,79,135,13.6],[25,75,133,12.9],[24,71,130,12.3],[23,66,126,11.7],[22,62,122,11.1],[21,58,119,10.5],[20,54,114,9.9]]),
  ...rows(0, 2200, 20, [[27,80,139,13.9],[26,76,136,13.2],[25,72,134,12.6],[24,68,130,11.9],[23,64,126,11.3],[22,60,123,10.8],[21,56,118,10.2],[20,52,114,9.7]]),

  // Cessna 182T NAV III, Figure 5-9, pressure altitude 2,000 feet.
  ...rows(2000, 2400, -20, [[24,81,136,14.1],[23,77,133,13.3],[22,72,130,12.5],[21,67,126,11.8],[20,62,122,11.0]]),
  ...rows(2000, 2400, 0, [[25,83,140,14.4],[24,79,138,13.6],[23,74,134,12.8],[22,69,131,12.1],[21,65,126,11.4],[20,60,122,10.7]]),
  ...rows(2000, 2400, 20, [[25,80,142,13.9],[24,76,139,13.2],[23,71,135,12.4],[22,67,131,11.7],[21,63,127,11.1],[20,58,122,10.5]]),

  ...rows(2000, 2300, -20, [[25,83,137,14.4],[24,78,134,13.6],[23,74,131,12.8],[22,69,128,12.1],[21,65,124,11.4],[20,60,120,10.7]]),
  ...rows(2000, 2300, 0, [[25,80,139,13.9],[24,76,136,13.1],[23,71,133,12.4],[22,67,128,11.7],[21,62,124,11.1],[20,58,120,10.5]]),
  ...rows(2000, 2300, 20, [[26,82,143,14.2],[25,77,140,13.4],[24,73,137,12.7],[23,69,133,12.0],[22,65,129,11.4],[21,60,125,10.8],[20,56,120,10.2]]),

  ...rows(2000, 2200, -20, [[25,80,135,13.8],[24,75,132,13.1],[23,71,129,12.4],[22,67,126,11.7],[21,62,122,11.1],[20,58,118,10.5]]),
  ...rows(2000, 2200, 0, [[26,81,139,14.1],[25,77,137,13.3],[24,73,134,12.6],[23,69,130,12.0],[22,64,126,11.4],[21,60,122,10.8],[20,56,118,10.2]]),
  ...rows(2000, 2200, 20, [[26,78,140,13.6],[25,74,138,12.9],[24,70,134,12.3],[23,66,130,11.6],[22,62,127,11.0],[21,58,122,10.5],[20,54,118,9.9]]),
];

export function isaTemperatureC(pressureAltitudeFt: number): number {
  return 15 - (2 * pressureAltitudeFt) / 1000;
}

export function calculateCruisePerformance(input: CruisePerformanceInput): CruisePerformanceResult {
  validateInput(input);

  const isaC = isaTemperatureC(input.pressureAltitudeFt);
  const offsetC = input.oatC - isaC;
  if (offsetC < CRUISE_PREVIEW_LIMITS.minTempOffsetC || offsetC > CRUISE_PREVIEW_LIMITS.maxTempOffsetC) {
    throw new Error('OAT is outside the current POH preview range of ISA -20°C to ISA +20°C.');
  }

  const altitudeBracket = bracket([0, 2000], input.pressureAltitudeFt);
  const rpmBracket = bracket([2200, 2300, 2400], input.rpm);

  const atAltitude = altitudeBracket.map((altitudeFt) => {
    const atRpm = rpmBracket.map((rpm) => evaluateGrid(altitudeFt, rpm, input.manifoldPressureInHg, offsetC));
    return interpolateResult(atRpm[0], atRpm.at(-1)!, fraction(rpmBracket[0], rpmBracket.at(-1)!, input.rpm));
  });

  const result = interpolateResult(
    atAltitude[0],
    atAltitude.at(-1)!,
    fraction(altitudeBracket[0], altitudeBracket.at(-1)!, input.pressureAltitudeFt),
  );

  return {
    percentMcp: result.percentMcp,
    ktas: result.ktas,
    fuelFlowGph: result.gph,
    isaTemperatureC: isaC,
    temperatureOffsetC: offsetC,
  };
}

function evaluateGrid(altitudeFt: number, rpm: number, mpInHg: number, tempOffsetC: number) {
  const tempBracket = bracket([-20, 0, 20], tempOffsetC);
  const values = tempBracket.map((temp) => interpolateMp(altitudeFt, rpm, temp as -20 | 0 | 20, mpInHg));
  return interpolateResult(values[0], values.at(-1)!, fraction(tempBracket[0], tempBracket.at(-1)!, tempOffsetC));
}

function interpolateMp(altitudeFt: number, rpm: number, tempOffsetC: -20 | 0 | 20, mpInHg: number) {
  const candidates = POINTS
    .filter((point) => point.altitudeFt === altitudeFt && point.rpm === rpm && point.tempOffsetC === tempOffsetC)
    .sort((a, b) => a.mpInHg - b.mpInHg);
  const mpBracket = bracket(candidates.map((point) => point.mpInHg), mpInHg);
  const lower = candidates.find((point) => point.mpInHg === mpBracket[0]);
  const upper = candidates.find((point) => point.mpInHg === mpBracket.at(-1));
  if (!lower || !upper) {
    throw new Error('No POH cruise data is available for this combination of RPM, MP and temperature.');
  }
  return interpolateResult(lower, upper, fraction(lower.mpInHg, upper.mpInHg, mpInHg));
}

function interpolateResult<T extends { percentMcp: number; ktas: number; gph: number }>(a: T, b: T, t: number) {
  return {
    percentMcp: lerp(a.percentMcp, b.percentMcp, t),
    ktas: lerp(a.ktas, b.ktas, t),
    gph: lerp(a.gph, b.gph, t),
  };
}

function bracket(values: number[], target: number): [number, number] {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (sorted.length === 0 || target < sorted[0] || target > sorted.at(-1)!) {
    throw new Error('Requested value is outside the currently loaded POH cruise table.');
  }
  const exact = sorted.find((value) => value === target);
  if (exact !== undefined) return [exact, exact];
  const lower = [...sorted].reverse().find((value) => value < target);
  const upper = sorted.find((value) => value > target);
  if (lower === undefined || upper === undefined) {
    throw new Error('Unable to bracket requested POH value for interpolation.');
  }
  return [lower, upper];
}

function validateInput(input: CruisePerformanceInput): void {
  if (!Number.isFinite(input.pressureAltitudeFt) || !Number.isFinite(input.oatC) || !Number.isFinite(input.rpm) || !Number.isFinite(input.manifoldPressureInHg)) {
    throw new Error('Cruise performance inputs must be numeric.');
  }
  if (input.pressureAltitudeFt < 0 || input.pressureAltitudeFt > 2000) {
    throw new Error('Phase 4 preview currently contains the POH sea-level and 2,000 ft tables only.');
  }
  if (input.rpm < 2200 || input.rpm > 2400) {
    throw new Error('Phase 4 preview currently supports 2200-2400 RPM.');
  }
}

function rows(
  altitudeFt: number,
  rpm: number,
  tempOffsetC: -20 | 0 | 20,
  values: Array<[number, number, number, number]>,
): CruisePoint[] {
  return values.map(([mpInHg, percentMcp, ktas, gph]) => ({
    altitudeFt,
    rpm,
    tempOffsetC,
    mpInHg,
    percentMcp,
    ktas,
    gph,
  }));
}

function fraction(a: number, b: number, value: number): number {
  return a === b ? 0 : (value - a) / (b - a);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
