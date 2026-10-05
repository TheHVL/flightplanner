import { describe, expect, it } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { calculateRouteLegs } from '../src/navigation/geodesy';
import { modeledAltitudeFtAtRouteDistance } from '../src/navigation/glideEnvelope';
import { calculateRouteVerticalProfile } from '../src/navigation/verticalProfile';
import { calculateFuelPlanForStore, DEFAULT_FUEL_PLANNING_SETTINGS } from '../src/fuel/fuelPlanning';
import type { Waypoint } from '../src/types';

const point = (id: string, lat: number, lon: number): Waypoint => ({id, name:id, lat, lon});
const settings = {
  departureElevationFt:0, destinationElevationFt:4000,
  climbRateFpm:500, descentRateFpm:500,
  climbGroundSpeedKt:120, descentGroundSpeedKt:120,
};
const bardufossRoute = [
  point('ENDU',69.05583333333333,18.540277777777778),
  point('NORA',69.10055555555554,18.611666666666668),
  point('TAKVATN',69.10972222222222,19.03888888888889),
  point('ENDU-return',69.05583333333333,18.540277777777778),
];

describe('continuous staged climbs', () => {
  it('continues the ENDU departure climb through NORA before climbing from 2000 to 3000 ft', () => {
    const legs = calculateRouteLegs(bardufossRoute);
    const levels = [2000,3000,3000];
    const profile = calculateRouteVerticalProfile({
      legs, plannedAltitudesFt:levels, waypointConstraints:[], ...settings,
      departureElevationFt:254, destinationElevationFt:254,
      climbPerformanceMode:'poh-normal-90', climbOatC:13,
    });
    const climbs = profile.events.filter(event => event.type === 'TOC');
    expect(climbs).toHaveLength(2);
    expect(climbs[0].routeDistanceNm).toBeGreaterThan(legs[0].distanceNm);
    expect(climbs[1].routeDistanceNm - climbs[1].distanceNm).toBeCloseTo(climbs[0].routeDistanceNm,8);
    expect(climbs[1].distanceFromWaypointNm).toBeCloseTo(climbs[1].routeDistanceNm - legs[0].distanceNm,8);
    expect(profile.profilesOverlap).toBe(false);
    expect(modeledAltitudeFtAtRouteDistance(legs,levels,profile.events,legs[0].distanceNm)).toBeLessThan(2000);
    expect(modeledAltitudeFtAtRouteDistance(legs,levels,profile.events,climbs[0].routeDistanceNm)).toBeCloseTo(2000,6);
    expect(modeledAltitudeFtAtRouteDistance(legs,levels,profile.events,climbs[1].routeDistanceNm)).toBeCloseTo(3000,6);
  });

  it('queues multiple PL increases while the original climb is still in progress', () => {
    const legs = calculateRouteLegs([point('A',0,0),point('B',0,0.01),point('C',0,0.02),point('D',0,0.5)]);
    const profile = calculateRouteVerticalProfile({legs,plannedAltitudesFt:[2000,3000,4000],waypointConstraints:[],...settings});
    const climbs = profile.events.filter(event => event.type === 'TOC');
    expect(climbs).toHaveLength(3);
    expect(climbs[1].routeDistanceNm-climbs[1].distanceNm).toBeCloseTo(climbs[0].routeDistanceNm,8);
    expect(climbs[2].routeDistanceNm-climbs[2].distanceNm).toBeCloseTo(climbs[1].routeDistanceNm,8);
    expect(climbs.reduce((sum, event) => sum + event.timeMin, 0)).toBe(8);
    expect(climbs.reduce((sum, event) => sum + event.distanceNm, 0)).toBe(16);
    expect(profile.profilesOverlap).toBe(false);
    expect(profile.warnings.join(' ')).toContain('cannot reach 3000 ft before C');
  });

  it('retains a real conflict when the climb cannot finish before the arrival descent', () => {
    const legs = calculateRouteLegs([point('A',0,0),point('B',0,0.01),point('C',0,0.08)]);
    const profile = calculateRouteVerticalProfile({legs,plannedAltitudesFt:[2000,3000],waypointConstraints:[],...settings,destinationElevationFt:0});
    expect(profile.profilesOverlap).toBe(true);
    expect(profile.overlapDistanceNm).toBeGreaterThan(0);
  });

  it('does not join a new airport departure onto an unfinished inbound climb', () => {
    const legs = calculateRouteLegs([point('A',0,0),point('Airport',0,0.01),point('C',0,0.5)]);
    const profile = calculateRouteVerticalProfile({legs,plannedAltitudesFt:[2000,3000],waypointConstraints:[{waypointId:'Airport',mode:'airport',elevationFt:0}],...settings,destinationElevationFt:3000});
    const airportClimb = profile.events.find(event => event.type==='TOC' && event.reason==='airport')!;
    expect(airportClimb.routeDistanceNm-airportClimb.distanceNm).toBeCloseTo(legs[0].distanceNm,8);
    expect(profile.profilesOverlap).toBe(true);
  });

  it('uses the wind at the continued climb position and counts phase time and fuel once', () => {
    const store = new FlightPlanStore();
    const a=store.addWaypoint({lat:0,lon:0},'A');
    const b=store.addWaypoint({lat:0,lon:0.02},'B');
    const c=store.addWaypoint({lat:0,lon:0.5},'C');
    store.setPlannedAltitudeFt(a.id,b.id,2000);store.setPlannedAltitudeFt(b.id,c.id,3000);
    store.updateVerticalProfileSettings({...settings,climbRateFpm:1000,destinationElevationFt:3000});
    store.updatePerformanceSettings({usePohPerformance:false});
    store.setManualLegWind(a.id,b.id,{windFromDeg:90,windSpeedKt:20});
    store.setManualLegWind(b.id,c.id,{windFromDeg:270,windSpeedKt:40});
    store.updateWeatherSettings({useForecastWinds:true});
    const plan=calculateFuelPlanForStore(store,{...DEFAULT_FUEL_PLANNING_SETTINGS,climbPerformanceMode:'manual',climbFuelFlowGph:18,manualCruiseFuelFlowGph:10});
    const climbs=plan.verticalProfile!.events.filter(event=>event.type==='TOC');
    expect(climbs[1].distanceNm).toBeCloseTo(160/60,6);
    expect(climbs[1].routeDistanceNm-climbs[1].distanceNm).toBeCloseTo(climbs[0].routeDistanceNm,6);
    expect(plan.legs.reduce((sum,leg)=>sum+leg.climbTimeMin,0)).toBeCloseTo(3,6);
    expect(plan.climbFuelGal).toBeCloseTo(18*3/60,6);
    expect(plan.tripFuelGal).toBeCloseTo(1.7+plan.climbFuelGal!+plan.cruiseFuelGal!,6);
    expect(plan.verticalProfile!.profilesOverlap).toBe(false);
  });
});
