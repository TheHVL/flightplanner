import { loadAipAerodromeCatalog, type AipAerodromeCatalog, type AipRefreshStatus, type AipAerodrome } from '../aip/aerodromes';
import { ROUTE_SHAPE_CHANGED_EVENT } from '../flightplan/RouteShapeController';
import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { FUEL_SETTINGS_CHANGED_EVENT, getFuelPlanningSettings } from '../fuel/fuelPlanning';
import { modeledAltitudeFtAtRouteDistance } from '../navigation/glideEnvelope';
import { calculateRouteVerticalProfile } from '../navigation/verticalProfile';
import type { RouteLeg, Waypoint } from '../types';
import { radioFreshness, validateRadioCatalog, type RadioCatalog } from './catalog';
import { planLegFrequencies, type FrequencySegment } from './routeFrequencies';
export interface AirportRadioContext { airport: AipAerodrome; position: 'Departure' | 'Arrival'; }
export interface LegFrequencyPlan { leg: RouteLeg; segments: FrequencySegment[]; airports: AirportRadioContext[]; manual: string | null; note?: string; }
export class FrequencyPlanner {
  private data: RadioCatalog | null = null;
  private airports: AipAerodromeCatalog | null = null;
  private refreshStatus: AipRefreshStatus | null = null;
  private cache: LegFrequencyPlan[] | null = null;
  private checkedMessage = 'Loading published ATS radio areas…';
  private listeners = new Set<() => void>();
  private loading = false;
  constructor(private readonly store: FlightPlanStore) {
    store.subscribe(() => { this.cache = null; });
    window.addEventListener(FUEL_SETTINGS_CHANGED_EVENT, () => { this.cache = null; });
    window.addEventListener(ROUTE_SHAPE_CHANGED_EVENT, () => { this.cache = null; this.emit(); });
  }
  subscribe(listener: () => void): void { this.listeners.add(listener); }
  getStatus(): string { return this.checkedMessage; }
  getCatalog(): RadioCatalog | null { return this.data; }
  isLoading(): boolean { return this.loading; }
  async reload(): Promise<void> {
    if (this.loading) return;
    this.loading = true; this.checkedMessage = 'Checking published ATS data…'; this.emit();
    try {
      const [response, statusResponse, airports] = await Promise.all([
        fetch(new URL('aip-frequencies.json', document.baseURI), { cache: 'no-store' }),
        fetch(new URL('aip-frequency-status.json', document.baseURI), { cache: 'no-store' }),
        loadAipAerodromeCatalog(true),
      ]);
      if (!response.ok) throw new Error(`ATS data unavailable (${response.status}).`);
      const data: unknown = await response.json(); validateRadioCatalog(data);
      this.data = data; this.airports = airports;
      this.refreshStatus = statusResponse.ok ? await statusResponse.json() as AipRefreshStatus : null;
    } catch (error) {
      this.data = null; this.refreshStatus = null;
      this.checkedMessage = `${error instanceof Error ? error.message : 'ATS data unavailable.'} Enter channels manually or check the AIP.`;
    } finally { this.loading = false; this.cache = null; this.emit(); }
  }
  getPlans(): LegFrequencyPlan[] {
    // Recheck timestamps even when the route is unchanged, so a long-open tab
    // cannot keep presenting old suggestions as current.
    const freshness = this.data && this.airports ? radioFreshness(this.data, this.refreshStatus, this.airports, new Date(), this.store.getWeatherSettings().departureTimeUtc) : null;
    if (freshness) this.checkedMessage = freshness.message;
    if (this.cache && freshness?.usable) return this.cache;
    const legs = this.store.getLegs();
    const levels = legs.map(l => this.store.getPlannedAltitudeFt(l.from.id, l.to.id));
    let events: Parameters<typeof modeledAltitudeFtAtRouteDistance>[2] = [], profileNote: string | undefined;
    if (legs.length && freshness?.usable) {
      try {
        const profile = calculateRouteVerticalProfile({ legs, plannedAltitudesFt: levels,
          waypointConstraints: this.store.getVerticalWaypointConstraints().map(c => ({ waypointId: c.waypointId, mode: c.mode, elevationFt: c.elevationFt })),
          ...this.store.getVerticalProfileSettings(), climbPerformanceMode: getFuelPlanningSettings().climbPerformanceMode, climbOatC: this.store.getPerformanceSettings().oatC });
        if (profile.profilesOverlap || profile.climbPerformanceIncomplete) profileNote = 'Resolve the climb/descent profile before using altitude-based channel suggestions.';
        else events = profile.events;
      } catch { profileNote = 'The vertical profile is unavailable. Check levels and aircraft settings.'; }
    }
    let offset = 0;
    this.cache = legs.map(leg => {
      const start = offset; offset += leg.distanceNm;
      const note = !freshness?.usable ? this.checkedMessage : profileNote;
      const segments = !note && this.data ? planLegFrequencies(leg, this.data,
        distance => levels[leg.index] === null ? null : modeledAltitudeFtAtRouteDistance(legs, levels, events, start + distance),
        events.flatMap(e => e.type === 'TOC' ? [e.routeDistanceNm - e.distanceNm - start, e.routeDistanceNm - start] : [e.routeDistanceNm - start, e.routeDistanceNm + e.distanceNm - start])) : [];
      const airports: AirportRadioContext[] = [];
      for (const [point, position] of [[leg.from, 'Departure'], [leg.to, 'Arrival']] as const) {
        const airport = this.airportForWaypoint(point);
        if (airport) airports.push({ airport, position });
      }
      return { leg, segments, airports, manual: this.store.getManualFrequency(leg.from.id, leg.to.id), note };
    });
    return this.cache;
  }
  private airportForWaypoint(point: Waypoint): AipAerodrome | undefined {
    const constraint = this.store.getWaypointVerticalConstraint(point.id);
    const waypoints = this.store.getWaypoints();
    const settings = this.store.getVerticalProfileSettings();
    const code = point.id === waypoints[0]?.id ? settings.departureIcaoCode : point.id === waypoints.at(-1)?.id ? settings.destinationIcaoCode : constraint.icaoCode;
    return this.airports?.aerodromes.find(a => a.icao === (code || point.aipId || point.name.toUpperCase()));
  }
  private emit(): void { this.listeners.forEach(listener => listener()); }
}
