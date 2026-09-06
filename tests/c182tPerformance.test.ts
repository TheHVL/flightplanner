import { describe, expect, it } from 'vitest';
import { C182TPerformanceProvider, pressureAltitudeFromQnh } from '../src/performance/C182TPerformanceProvider';
const provider = new C182TPerformanceProvider();
describe('C182TPerformanceProvider', () => {
  it('reproduces an exact published POH entry exactly', () => { const result=provider.getCruisePerformance({pressureAltitudeFt:0,oatC:15,rpm:2100,manifoldPressureInHg:23}); expect(result.status).toBe('ok'); if(result.status!=='ok') return; expect(result.performance).toEqual({percentMcp:63,ktas:123,gph:11.2,exactTableEntry:true}); });
  it('interpolates temperature', () => { const result=provider.getCruisePerformance({pressureAltitudeFt:0,oatC:5,rpm:2100,manifoldPressureInHg:23}); expect(result.status).toBe('ok'); if(result.status!=='ok') return; expect(result.performance.percentMcp).toBeCloseTo(64.5,8); expect(result.performance.ktas).toBeCloseTo(123,8); expect(result.performance.gph).toBeCloseTo(11.35,8); });
  it('interpolates RPM and manifold pressure', () => { const result=provider.getCruisePerformance({pressureAltitudeFt:6000,oatC:3,rpm:2250,manifoldPressureInHg:21.5}); expect(result.status).toBe('ok'); if(result.status!=='ok') return; expect(result.performance.percentMcp).toBeCloseTo(67.75,8); expect(result.performance.ktas).toBeCloseTo(133.5,8); expect(result.performance.gph).toBeCloseTo(11.85,8); });
  it('interpolates pressure altitude', () => { const result=provider.getCruisePerformance({pressureAltitudeFt:1000,oatC:10,rpm:2100,manifoldPressureInHg:23}); expect(result.status).toBe('ok'); if(result.status!=='ok') return; expect(result.performance.percentMcp).toBeCloseTo(64.45,8); expect(result.performance.ktas).toBeCloseTo(125,8); expect(result.performance.gph).toBeCloseTo(11.395,8); });
  it('refuses requests outside the published POH range', () => { expect(provider.getCruisePerformance({pressureAltitudeFt:15000,oatC:-10,rpm:2300,manifoldPressureInHg:16})).toEqual({status:'outside-range',warning:'Outside published POH cruise performance range.'}); });
  it('calculates pressure altitude from QNH', () => { expect(pressureAltitudeFromQnh(4500,1003.25)).toBeCloseTo(4770,8); });
});
