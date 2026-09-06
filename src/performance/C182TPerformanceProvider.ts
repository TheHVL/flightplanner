import { C182T_CRUISE_PERFORMANCE, type CruisePerformanceCell, type CruisePerformanceRpmGroup, type CruisePerformanceTable } from '../data/aircraft/c182tCruisePerformance';

export interface C182TCruiseRequest { pressureAltitudeFt: number; oatC: number; rpm: number; manifoldPressureInHg: number; }
export interface C182TCruisePerformance { percentMcp: number; ktas: number; gph: number; exactTableEntry: boolean; }
export type C182TCruiseResult = { status: 'ok'; performance: C182TCruisePerformance } | { status: 'outside-range'; warning: 'Outside published POH cruise performance range.' };
interface InterpolatedCell { percentMcp: number; ktas: number; gph: number; exact: boolean; }
const OUTSIDE_RANGE: C182TCruiseResult = { status: 'outside-range', warning: 'Outside published POH cruise performance range.' };

export class C182TPerformanceProvider {
  getCruisePerformance(request: C182TCruiseRequest): C182TCruiseResult {
    const altitudeBracket = bracket(C182T_CRUISE_PERFORMANCE, request.pressureAltitudeFt, (table) => table.pressureAltitudeFt);
    if (!altitudeBracket) return OUTSIDE_RANGE;
    const low = this.interpolateWithinAltitude(altitudeBracket.low, request);
    if (!low) return OUTSIDE_RANGE;
    if (altitudeBracket.low === altitudeBracket.high) return { status: 'ok', performance: { percentMcp: low.percentMcp, ktas: low.ktas, gph: low.gph, exactTableEntry: low.exact } };
    const high = this.interpolateWithinAltitude(altitudeBracket.high, request);
    if (!high) return OUTSIDE_RANGE;
    const value = interpolateCell(low, high, fraction(request.pressureAltitudeFt, altitudeBracket.low.pressureAltitudeFt, altitudeBracket.high.pressureAltitudeFt));
    return { status: 'ok', performance: { percentMcp: value.percentMcp, ktas: value.ktas, gph: value.gph, exactTableEntry: false } };
  }

  private interpolateWithinAltitude(table: CruisePerformanceTable, request: C182TCruiseRequest): InterpolatedCell | null {
    const temperatureBracket = bracket(table.oatC.map((oatC, index) => ({ oatC, index })), request.oatC, (item) => item.oatC);
    if (!temperatureBracket) return null;
    const low = this.interpolateRpmAndMp(table, temperatureBracket.low.index, request.rpm, request.manifoldPressureInHg);
    if (!low) return null;
    if (temperatureBracket.low.index === temperatureBracket.high.index) return low;
    const high = this.interpolateRpmAndMp(table, temperatureBracket.high.index, request.rpm, request.manifoldPressureInHg);
    if (!high) return null;
    return interpolateCell(low, high, fraction(request.oatC, temperatureBracket.low.oatC, temperatureBracket.high.oatC));
  }

  private interpolateRpmAndMp(table: CruisePerformanceTable, temperatureIndex: number, rpm: number, manifoldPressureInHg: number): InterpolatedCell | null {
    const rpmBracket = bracket(table.rpmGroups, rpm, (group) => group.rpm);
    if (!rpmBracket) return null;
    const low = interpolateMp(rpmBracket.low, temperatureIndex, manifoldPressureInHg);
    if (!low) return null;
    if (rpmBracket.low.rpm === rpmBracket.high.rpm) return low;
    const high = interpolateMp(rpmBracket.high, temperatureIndex, manifoldPressureInHg);
    if (!high) return null;
    return interpolateCell(low, high, fraction(rpm, rpmBracket.low.rpm, rpmBracket.high.rpm));
  }
}

export function pressureAltitudeFromQnh(plannedAltitudeFt: number, qnhHpa: number): number {
  if (!Number.isFinite(plannedAltitudeFt) || !Number.isFinite(qnhHpa) || qnhHpa <= 0) throw new Error('Altitude and QNH must be valid numbers.');
  return plannedAltitudeFt + (1013.25 - qnhHpa) * 27;
}

function interpolateMp(group: CruisePerformanceRpmGroup, temperatureIndex: number, manifoldPressureInHg: number): InterpolatedCell | null {
  const available = group.rows.map((row) => ({ manifoldPressureInHg: row[0], cell: row[temperatureIndex + 1] as CruisePerformanceCell | null })).filter((item): item is { manifoldPressureInHg: number; cell: CruisePerformanceCell } => item.cell !== null);
  const mpBracket = bracket(available, manifoldPressureInHg, (item) => item.manifoldPressureInHg);
  if (!mpBracket) return null;
  const low = fromRawCell(mpBracket.low.cell);
  if (mpBracket.low.manifoldPressureInHg === mpBracket.high.manifoldPressureInHg) return low;
  const high = fromRawCell(mpBracket.high.cell);
  return interpolateCell(low, high, fraction(manifoldPressureInHg, mpBracket.low.manifoldPressureInHg, mpBracket.high.manifoldPressureInHg));
}

function fromRawCell(cell: CruisePerformanceCell): InterpolatedCell { return { percentMcp: cell[0], ktas: cell[1], gph: cell[2], exact: true }; }
function interpolateCell(low: InterpolatedCell, high: InterpolatedCell, ratio: number): InterpolatedCell { return { percentMcp: lerp(low.percentMcp, high.percentMcp, ratio), ktas: lerp(low.ktas, high.ktas, ratio), gph: lerp(low.gph, high.gph, ratio), exact: low.exact && high.exact && ratio === 0 }; }
function lerp(low: number, high: number, ratio: number): number { return low + (high - low) * ratio; }
function fraction(value: number, low: number, high: number): number { return low === high ? 0 : (value - low) / (high - low); }
function bracket<T>(values: readonly T[], target: number, selector: (value: T) => number): { low: T; high: T } | null {
  const sorted = [...values].sort((a, b) => selector(a) - selector(b));
  if (sorted.length === 0) return null;
  if (target < selector(sorted[0]) || target > selector(sorted[sorted.length - 1])) return null;
  const exact = sorted.find((value) => selector(value) === target);
  if (exact) return { low: exact, high: exact };
  const highIndex = sorted.findIndex((value) => selector(value) > target);
  if (highIndex <= 0) return null;
  return { low: sorted[highIndex - 1], high: sorted[highIndex] };
}
