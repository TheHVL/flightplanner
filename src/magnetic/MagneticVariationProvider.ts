import type { Coordinate } from '../types';

export interface MagneticVariationProvider {
  getVariationDegEastPositive(position: Coordinate, altitudeFt?: number, date?: Date): number;
}

export class ManualMagneticVariationProvider implements MagneticVariationProvider {
  constructor(private variationDegEastPositive: number) {}

  setVariation(variationDegEastPositive: number): void {
    this.variationDegEastPositive = variationDegEastPositive;
  }

  getVariationDegEastPositive(): number {
    return this.variationDegEastPositive;
  }
}
