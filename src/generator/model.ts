import { generatorFuelSettings } from './aircraft';
import { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { calculateFuelPlanForStore } from '../fuel/fuelPlanning';
import { modeledAltitudeFtAtRouteDistance } from '../navigation/glideEnvelope';
import type { GeneratorRequest, RouteCandidate } from './candidates';

export function candidateAltitudeModel(candidate: RouteCandidate, request: GeneratorRequest) {
  const store = new FlightPlanStore(); store.restoreWorkingDraftState(candidate.draft);
  const fuel = calculateFuelPlanForStore(store, generatorFuelSettings(request));
  const levels = candidate.legs.map(leg => store.getPlannedAltitudeFt(leg.from.id, leg.to.id));
  const offsets: number[] = []; let offset = 0;
  candidate.legs.forEach(leg => { offsets[leg.index] = offset; offset += leg.distanceNm; });
  const profile = fuel.verticalProfile;
  return { at: (index: number, distance: number) => !profile || candidate.profileIssues.length ? null : modeledAltitudeFtAtRouteDistance(candidate.legs, levels, profile.events, offsets[index] + distance),
    breaks: profile?.events.flatMap(event => event.type === 'TOC' ? [event.routeDistanceNm - event.distanceNm, event.routeDistanceNm] : [event.routeDistanceNm, event.routeDistanceNm + event.distanceNm]) ?? [] };
}
