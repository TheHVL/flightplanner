export interface WindTriangleInput {
  trueTrackDeg: number;
  tasKt: number;
  windFromDeg: number;
  windSpeedKt: number;
}

export interface WindTriangleResult {
  wcaDeg: number;
  trueHeadingDeg: number;
  groundSpeedKt: number;
}

export function normalizeHeading(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function trueToMagnetic(trueDeg: number, variationDegEast: number): number {
  return normalizeHeading(trueDeg - variationDegEast);
}

export function solveWindTriangle(input: WindTriangleInput): WindTriangleResult {
  const { trueTrackDeg, tasKt, windFromDeg, windSpeedKt } = input;

  if (!Number.isFinite(tasKt) || tasKt <= 0) {
    throw new Error('TAS must be greater than zero.');
  }
  if (!Number.isFinite(windSpeedKt) || windSpeedKt < 0) {
    throw new Error('Wind speed cannot be negative.');
  }

  const toRad = Math.PI / 180;
  const relativeWindRad = (windFromDeg - trueTrackDeg) * toRad;
  const crosswindKt = windSpeedKt * Math.sin(relativeWindRad);
  const ratio = crosswindKt / tasKt;

  if (Math.abs(ratio) >= 1) {
    throw new Error('Wind is too strong to maintain the selected track at this TAS.');
  }

  const wcaDeg = Math.asin(ratio) / toRad;
  const trueHeadingDeg = normalizeHeading(trueTrackDeg + wcaDeg);
  const alongTrackWindKt = -windSpeedKt * Math.cos(relativeWindRad);
  const groundSpeedKt = tasKt * Math.cos(wcaDeg * toRad) + alongTrackWindKt;

  if (groundSpeedKt <= 0) {
    throw new Error('Calculated groundspeed is not positive.');
  }

  return { wcaDeg, trueHeadingDeg, groundSpeedKt };
}
