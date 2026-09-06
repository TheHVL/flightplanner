import { degreesToRadians, normalizeDegrees, radiansToDegrees } from '../utils/angles';

export interface WindTriangleInput {
  trueTrackDeg: number;
  tasKt: number;
  windFromDegTrue: number;
  windSpeedKt: number;
}

export interface WindTriangleResult {
  wcaDeg: number;
  trueHeadingDeg: number;
  groundspeedKt: number;
  headwindComponentKt: number;
  crosswindComponentKt: number;
}

export class WindTriangleCalculator {
  calculate(input: WindTriangleInput): WindTriangleResult {
    const { trueTrackDeg, tasKt, windFromDegTrue, windSpeedKt } = input;

    if (tasKt <= 0) {
      throw new Error('TAS must be greater than zero.');
    }
    if (windSpeedKt < 0) {
      throw new Error('Wind speed cannot be negative.');
    }

    const relativeWindRad = degreesToRadians(normalizeDegrees(windFromDegTrue - trueTrackDeg));
    const crosswindComponentKt = windSpeedKt * Math.sin(relativeWindRad);
    const headwindComponentKt = windSpeedKt * Math.cos(relativeWindRad);
    const ratio = crosswindComponentKt / tasKt;

    if (Math.abs(ratio) > 1) {
      throw new Error('Wind exceeds the aircraft crosswind correction capability for the selected TAS.');
    }

    const wcaRad = Math.asin(ratio);
    const wcaDeg = radiansToDegrees(wcaRad);
    const trueHeadingDeg = normalizeDegrees(trueTrackDeg + wcaDeg);
    const groundspeedKt = tasKt * Math.cos(wcaRad) - headwindComponentKt;

    if (groundspeedKt <= 0) {
      throw new Error('Calculated groundspeed is not positive.');
    }

    return {
      wcaDeg,
      trueHeadingDeg,
      groundspeedKt,
      headwindComponentKt,
      crosswindComponentKt,
    };
  }
}
