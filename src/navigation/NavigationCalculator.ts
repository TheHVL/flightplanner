import type { RouteLeg } from '../types';
import { normalizeDegrees } from '../utils/angles';
import { WindTriangleCalculator } from './WindTriangleCalculator';

export interface NavigationAssumptions {
  tasKt: number;
  windFromDegTrue: number;
  windSpeedKt: number;
  variationDegEastPositive: number;
  fuelFlowGph: number;
}

export interface CalculatedNavigationLeg extends RouteLeg {
  magneticTrackDeg: number;
  wcaDeg: number;
  trueHeadingDeg: number;
  magneticHeadingDeg: number;
  groundspeedKt: number;
  timeMinutes: number;
  legFuelGal: number;
  accumulatedFuelGal: number;
  accumulatedTimeMinutes: number;
}

export class NavigationCalculator {
  private readonly windTriangle = new WindTriangleCalculator();

  calculateLegs(legs: RouteLeg[], assumptions: NavigationAssumptions): CalculatedNavigationLeg[] {
    let accumulatedFuelGal = 0;
    let accumulatedTimeMinutes = 0;

    return legs.map((leg) => {
      const wind = this.windTriangle.calculate({
        trueTrackDeg: leg.trueTrackDeg,
        tasKt: assumptions.tasKt,
        windFromDegTrue: assumptions.windFromDegTrue,
        windSpeedKt: assumptions.windSpeedKt,
      });
      const magneticTrackDeg = normalizeDegrees(leg.trueTrackDeg - assumptions.variationDegEastPositive);
      const magneticHeadingDeg = normalizeDegrees(wind.trueHeadingDeg - assumptions.variationDegEastPositive);
      const timeMinutes = (leg.distanceNm / wind.groundspeedKt) * 60;
      const legFuelGal = assumptions.fuelFlowGph * (timeMinutes / 60);

      accumulatedFuelGal += legFuelGal;
      accumulatedTimeMinutes += timeMinutes;

      return {
        ...leg,
        magneticTrackDeg,
        wcaDeg: wind.wcaDeg,
        trueHeadingDeg: wind.trueHeadingDeg,
        magneticHeadingDeg,
        groundspeedKt: wind.groundspeedKt,
        timeMinutes,
        legFuelGal,
        accumulatedFuelGal,
        accumulatedTimeMinutes,
      };
    });
  }
}
