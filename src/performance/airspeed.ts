/** Low-speed density correction, treating IAS as EAS. Instrument/position and
 * compressibility corrections are not available. Pressure altitude remains a PL proxy.
 * EAS/TAS relation: NASA NACA TN 4346, Standard Nomenclature for Airspeeds.
 * https://ntrs.nasa.gov/api/citations/19930091914/downloads/19930091914.pdf
 */
export function approximateTasFromIas(iasKt: number, pressureAltitudeFt: number, oatC: number): number {
  if (!Number.isFinite(iasKt) || iasKt <= 0 || !Number.isFinite(pressureAltitudeFt) || pressureAltitudeFt < 0 || pressureAltitudeFt > 20000 || !Number.isFinite(oatC) || oatC <= -273.15) throw new Error('Check the climb IAS, altitude and temperature.');
  const standardTemperatureRatio = 1 - 0.0065 * pressureAltitudeFt * 0.3048 / 288.15;
  const pressureRatio = standardTemperatureRatio ** 5.25588;
  const densityRatio = pressureRatio * 288.15 / (oatC + 273.15);
  return iasKt / Math.sqrt(densityRatio);
}
