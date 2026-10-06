import { calculateCruisePerformance } from '../performance/cruisePerformance';
import { normalizeManualChannels } from '../frequencies/channels';
import type { AipAerodromeCatalog } from '../aip/aerodromes';
import type { PublishedMapPoint } from '../aip/mapPoints';
import type { Coordinate, RouteLeg, Waypoint } from '../types';
import { calculateRouteLegs, greatCircleDistanceNm } from '../navigation/geodesy';

type Listener = () => void;

export interface NavigationSettings {
  tasKt: number;
  windFromDeg: number;
  windSpeedKt: number;
  variationDegEast: number;
  automaticVariation: boolean;
}

export interface PerformanceSettings {
  usePohPerformance: boolean;
  pressureAltitudeFt: number;
  oatC: number;
  rpm: number;
  manifoldPressureInHg: number;
}

export interface WeatherSettings {
  useForecastWinds: boolean;
  departureTimeUtc: string;
}

export interface VerticalLegWind {
  windFromDeg: number;
  windSpeedKt: number;
}

export interface ManualLegWind extends VerticalLegWind {
  fromId: string;
  toId: string;
}

export interface VerticalProfileSettings {
  departureElevationFt: number;
  destinationElevationFt: number;
  departureIcaoCode: string;
  destinationIcaoCode: string;
  climbRateFpm: number;
  descentRateFpm: number;
  /** Legacy field name. The UI now treats this as manual climb TAS. */
  climbGroundSpeedKt: number;
  /** Legacy field name. The UI now treats this as descent TAS. */
  descentGroundSpeedKt: number;
  climbSpeedMode?: 'tas' | 'ias';
  descentSpeedMode?: 'manual' | 'cruise';
  /** Derived cruise TAS for the selected power, each leg level and temperature. */
  legCruiseTasKt?: Array<number | null>;
  /** Derived on read so all vertical-profile consumers use the same active per-leg winds. */
  legWinds?: VerticalLegWind[];
  /** Derived on read from route weather where available, otherwise the Phase 4 OAT fallback. */
  legOatC?: Array<number | null>;
}

export type WaypointVerticalMode = 'auto' | 'airport' | 'circuits' | 'none';

export interface WaypointVerticalConstraint {
  mode: WaypointVerticalMode;
  elevationFt: number | null;
  icaoCode: string;
  circuitCount: number;
  minutesPerCircuit: number;
}

export interface LegWeatherForecast {
  fromId: string;
  toId: string;
  altitudeFt: number;
  validTimeUtc: string;
  windFromDeg: number;
  windSpeedKt: number;
  temperatureC: number;
  source: string;
  fetchedAtUtc?: string;
  modelSelection?: 'best_match';
  modelName?: string | null;
  modelRunTimeUtc?: string | null;
}

export interface FlightPlanWorkingDraftState {
  waypoints: Waypoint[];
  navigationSettings: NavigationSettings;
  performanceSettings: PerformanceSettings;
  weatherSettings: WeatherSettings;
  verticalProfileSettings: VerticalProfileSettings;
  plannedAltitudesFt: Array<[string, number]>;
  manualMsaFt: Array<[string, number]>;
  manualFrequencies: Array<[string, string]>;
  manualLegWinds: Array<[string, VerticalLegWind]>;
  verticalWaypointConstraints: Array<[string, WaypointVerticalConstraint]>;
  automaticWaypointIds: string[];
}

interface FlightPlanSnapshot extends FlightPlanWorkingDraftState {
  weatherForecasts: Array<[string, LegWeatherForecast]>;
}

const DEFAULT_NAVIGATION_SETTINGS: NavigationSettings = {
  tasKt: 130,
  windFromDeg: 0,
  windSpeedKt: 0,
  variationDegEast: 7,
  automaticVariation: true,
};

const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  usePohPerformance: true,
  pressureAltitudeFt: 1000,
  oatC: 13,
  rpm: 2200,
  manifoldPressureInHg: 20,
};

const DEFAULT_WEATHER_SETTINGS: WeatherSettings = {
  useForecastWinds: false,
  departureTimeUtc: nextWholeUtcHour(),
};

const DEFAULT_VERTICAL_PROFILE_SETTINGS: VerticalProfileSettings = {
  departureElevationFt: 0,
  destinationElevationFt: 0,
  departureIcaoCode: '',
  destinationIcaoCode: '',
  climbRateFpm: 700,
  descentRateFpm: 500,
  climbGroundSpeedKt: 90,
  descentGroundSpeedKt: 120,
};

const DEFAULT_WAYPOINT_VERTICAL_CONSTRAINT: WaypointVerticalConstraint = {
  mode: 'auto',
  elevationFt: null,
  icaoCode: '',
  circuitCount: 1,
  minutesPerCircuit: 6,
};

const MAX_UNDO_STEPS = 50;
const MANUAL_LEG_WIND_SOURCE = 'Manual per-leg wind backup';

export class FlightPlanStore {
  private waypoints: Waypoint[] = [];
  private airportCatalog: AipAerodromeCatalog | null = null;
  private navigationSettings: NavigationSettings = { ...DEFAULT_NAVIGATION_SETTINGS };
  private performanceSettings: PerformanceSettings = { ...DEFAULT_PERFORMANCE_SETTINGS };
  private weatherSettings: WeatherSettings = { ...DEFAULT_WEATHER_SETTINGS };
  private verticalProfileSettings: VerticalProfileSettings = { ...DEFAULT_VERTICAL_PROFILE_SETTINGS };
  private plannedAltitudesFt = new Map<string, number>();
  private manualMsaFt = new Map<string, number>();
  private manualFrequencies = new Map<string, string>();
  private manualLegWinds = new Map<string, VerticalLegWind>();
  private weatherForecasts = new Map<string, LegWeatherForecast>();
  private verticalWaypointConstraints = new Map<string, WaypointVerticalConstraint>();
  private automaticWaypointIds = new Set<string>();
  private listeners = new Set<Listener>();
  private undoStack: FlightPlanSnapshot[] = [];

  getWaypoints(): Waypoint[] {
    return this.waypoints.map((waypoint) => ({ ...waypoint }));
  }

  getLegs(): RouteLeg[] {
    return calculateRouteLegs(this.waypoints);
  }

  getNavigationSettings(): NavigationSettings {
    return { ...this.navigationSettings };
  }

  getPerformanceSettings(): PerformanceSettings {
    return { ...this.performanceSettings };
  }

  getWeatherSettings(): WeatherSettings {
    return { ...this.weatherSettings };
  }

  getVerticalProfileSettings(): VerticalProfileSettings {
    const legs = this.getLegs();
    const legWinds = legs.map((leg) => {
      const forecast = this.getLegWeatherForecast(leg.from.id, leg.to.id);
      if (this.weatherSettings.useForecastWinds && forecast) {
        return { windFromDeg: forecast.windFromDeg, windSpeedKt: forecast.windSpeedKt };
      }
      return {
        windFromDeg: this.navigationSettings.windFromDeg,
        windSpeedKt: this.navigationSettings.windSpeedKt,
      };
    });
    const legOatC = legs.map((leg) =>
      this.getLegWeatherForecast(leg.from.id, leg.to.id)?.temperatureC ?? this.performanceSettings.oatC,
    );
    const legCruiseTasKt = legs.map((leg, index) => {
      if (!this.performanceSettings.usePohPerformance) return this.navigationSettings.tasKt;
      try { return calculateCruisePerformance({ ...this.performanceSettings,
        pressureAltitudeFt: this.getPlannedAltitudeFt(leg.from.id, leg.to.id) ?? this.performanceSettings.pressureAltitudeFt,
        oatC: legOatC[index],
      }).ktas; } catch { return null; }
    });
    return { ...this.verticalProfileSettings, legWinds, legOatC, legCruiseTasKt };
  }

  exportWorkingDraftState(): FlightPlanWorkingDraftState {
    return {
      waypoints: this.waypoints.map((waypoint) => ({ ...waypoint })),
      navigationSettings: { ...this.navigationSettings },
      performanceSettings: { ...this.performanceSettings },
      weatherSettings: { ...this.weatherSettings },
      verticalProfileSettings: { ...this.verticalProfileSettings },
      plannedAltitudesFt: [...this.plannedAltitudesFt.entries()],
      manualMsaFt: [...this.manualMsaFt.entries()],
      manualFrequencies: [...this.manualFrequencies.entries()],
      manualLegWinds: [...this.manualLegWinds.entries()].map(([key, wind]) => [key, { ...wind }]),
      verticalWaypointConstraints: [...this.verticalWaypointConstraints.entries()].map(([key, constraint]) => [key, { ...constraint }]),
      automaticWaypointIds: [...this.automaticWaypointIds],
    };
  }

  restoreWorkingDraftState(value: unknown): boolean {
    const draft = parseWorkingDraftState(value);
    if (!draft) return false;

    this.waypoints = draft.waypoints.map((waypoint) => ({ ...waypoint }));
    this.navigationSettings = { ...draft.navigationSettings };
    this.performanceSettings = { ...draft.performanceSettings };
    this.weatherSettings = { ...draft.weatherSettings };
    this.verticalProfileSettings = { ...draft.verticalProfileSettings };
    this.plannedAltitudesFt = new Map(draft.plannedAltitudesFt);
    this.manualMsaFt = new Map(draft.manualMsaFt);
    this.manualFrequencies = new Map(draft.manualFrequencies);
    this.manualLegWinds = new Map(
      draft.manualLegWinds.map(([key, wind]) => [key, { ...wind }]),
    );
    this.verticalWaypointConstraints = new Map(
      draft.verticalWaypointConstraints.map(([key, constraint]) => [key, { ...constraint }]),
    );
    // Forecast responses are intentionally not persisted. They must be fetched again
    // for the restored route, time and altitude inputs.
    this.weatherForecasts.clear();
    this.automaticWaypointIds = new Set(draft.automaticWaypointIds);
    this.undoStack = [];
    this.renumberAutomaticWaypointNames();
    this.retainCurrentLegSettings();
    this.emit();
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  undoLastAction(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.restoreSnapshot(previous);
    this.emit();
    return true;
  }

  getWaypointVerticalConstraint(waypointId: string): WaypointVerticalConstraint {
    const constraint = this.verticalWaypointConstraints.get(waypointId);
    // Old plans may contain patterns at generic points. Retain their saved data,
    // but only calculate them when the waypoint can be identified as an airport.
    if (constraint?.mode === 'circuits' && !this.isAirportWaypoint(waypointId)) return { ...constraint, mode: 'auto' };
    return constraint ? { ...constraint } : { ...DEFAULT_WAYPOINT_VERTICAL_CONSTRAINT };
  }

  setAipAerodromeCatalog(catalog: AipAerodromeCatalog): void {
    this.airportCatalog = catalog;
    this.emit();
  }

  isAirportWaypoint(waypointId: string): boolean {
    const point = this.waypoints.find(p => p.id === waypointId);
    if (!point) return false;
    if (point.aipId) return /^EN[A-Z]{2}$/.test(point.aipId) && /^\d{4}-\d{2}-\d{2}$/.test(point.aipEffectiveDate ?? '');
    // Support older saved airport visits, while rejecting a typed ICAO code at
    // an unrelated position. Reporting-point provenance always takes priority.
    const constraint = this.verticalWaypointConstraints.get(waypointId);
    const code = constraint?.icaoCode || point.name.toUpperCase();
    const airport = this.airportCatalog?.aerodromes.find(a => a.icao === code);
    return !!airport && airport.lat !== null && airport.lon !== null && greatCircleDistanceNm(point, { lat: airport.lat, lon: airport.lon }) <= 0.05;
  }

  getVerticalWaypointConstraints(): Array<{ waypointId: string } & WaypointVerticalConstraint> {
    return this.waypoints
      .slice(1, -1)
      .map((waypoint) => ({ waypointId: waypoint.id, ...this.getWaypointVerticalConstraint(waypoint.id) }));
  }

  getWaypointActivityMinutes(waypointId: string): number {
    const constraint = this.getWaypointVerticalConstraint(waypointId);
    if (constraint.mode !== 'circuits') return 0;
    return constraint.circuitCount * constraint.minutesPerCircuit;
  }

  getTotalWaypointActivityMinutes(): number {
    return this.waypoints.reduce((sum, waypoint) => sum + this.getWaypointActivityMinutes(waypoint.id), 0);
  }

  getPlannedAltitudeFt(fromId: string, toId: string): number | null {
    return this.plannedAltitudesFt.get(this.legKey(fromId, toId)) ?? null;
  }

  getManualMsaFt(fromId: string, toId: string): number | null {
    return this.manualMsaFt.get(this.legKey(fromId, toId)) ?? null;
  }

  getManualLegWind(fromId: string, toId: string): VerticalLegWind | null {
    const wind = this.manualLegWinds.get(this.legKey(fromId, toId));
    return wind ? { ...wind } : null;
  }

  getManualLegWinds(): ManualLegWind[] {
    return this.getLegs()
      .map((leg) => {
        const wind = this.getManualLegWind(leg.from.id, leg.to.id);
        return wind ? { fromId: leg.from.id, toId: leg.to.id, ...wind } : null;
      })
      .filter((wind): wind is ManualLegWind => wind !== null);
  }

  getLegWeatherForecast(fromId: string, toId: string): LegWeatherForecast | null {
    const key = this.legKey(fromId, toId);
    const forecast = this.weatherForecasts.get(key);
    if (forecast) return { ...forecast };

    const manualWind = this.manualLegWinds.get(key);
    if (!manualWind) return null;

    return {
      fromId,
      toId,
      altitudeFt: this.getPlannedAltitudeFt(fromId, toId) ?? this.performanceSettings.pressureAltitudeFt,
      validTimeUtc: manualWindValidTime(this.weatherSettings.departureTimeUtc),
      windFromDeg: manualWind.windFromDeg,
      windSpeedKt: manualWind.windSpeedKt,
      temperatureC: this.performanceSettings.oatC,
      source: MANUAL_LEG_WIND_SOURCE,
    };
  }

  getWeatherForecasts(): LegWeatherForecast[] {
    return this.getLegs()
      .map((leg) => this.weatherForecasts.get(this.legKey(leg.from.id, leg.to.id)))
      .filter((forecast): forecast is LegWeatherForecast => forecast !== undefined)
      .map((forecast) => ({ ...forecast }));
  }

  updateNavigationSettings(patch: Partial<NavigationSettings>): void {
    if (!hasPatchDifference(this.navigationSettings, patch)) return;
    this.rememberUndo();
    this.navigationSettings = { ...this.navigationSettings, ...patch };
    this.emit();
  }

  updatePerformanceSettings(patch: Partial<PerformanceSettings>): void {
    if (!hasPatchDifference(this.performanceSettings, patch)) return;
    this.rememberUndo();
    this.performanceSettings = { ...this.performanceSettings, ...patch };
    this.emit();
  }

  updateWeatherSettings(patch: Partial<WeatherSettings>): void {
    if (!hasPatchDifference(this.weatherSettings, patch)) return;
    this.rememberUndo();
    if (patch.departureTimeUtc !== undefined && patch.departureTimeUtc !== this.weatherSettings.departureTimeUtc) {
      this.weatherForecasts.clear();
    }
    this.weatherSettings = { ...this.weatherSettings, ...patch };
    this.emit();
  }

  updateVerticalProfileSettings(patch: Partial<VerticalProfileSettings>): void {
    const { legWinds: _legWinds, legOatC: _legOatC, legCruiseTasKt: _legCruiseTasKt, ...editablePatch } = patch;
    const next: VerticalProfileSettings = {
      ...this.verticalProfileSettings,
      ...editablePatch,
      departureIcaoCode: editablePatch.departureIcaoCode === undefined
        ? this.verticalProfileSettings.departureIcaoCode
        : normalizeIcao(editablePatch.departureIcaoCode),
      destinationIcaoCode: editablePatch.destinationIcaoCode === undefined
        ? this.verticalProfileSettings.destinationIcaoCode
        : normalizeIcao(editablePatch.destinationIcaoCode),
    };
    if (
      !Number.isFinite(next.departureElevationFt) || next.departureElevationFt < 0 || next.departureElevationFt > 20000 ||
      !Number.isFinite(next.destinationElevationFt) || next.destinationElevationFt < 0 || next.destinationElevationFt > 20000 ||
      !Number.isFinite(next.climbRateFpm) || next.climbRateFpm <= 0 || next.climbRateFpm > 5000 ||
      !Number.isFinite(next.descentRateFpm) || next.descentRateFpm <= 0 || next.descentRateFpm > 5000 ||
      !Number.isFinite(next.climbGroundSpeedKt) || next.climbGroundSpeedKt <= 0 || next.climbGroundSpeedKt > 300 ||
      !Number.isFinite(next.descentGroundSpeedKt) || next.descentGroundSpeedKt <= 0 || next.descentGroundSpeedKt > 300
    ) {
      return;
    }
    if (next.climbSpeedMode !== undefined && !['tas', 'ias'].includes(next.climbSpeedMode)) return;
    if (next.descentSpeedMode !== undefined && !['manual', 'cruise'].includes(next.descentSpeedMode)) return;
    if (shallowEqual(this.verticalProfileSettings, next)) return;
    this.rememberUndo();
    this.verticalProfileSettings = next;
    this.emit();
  }

  setWaypointVerticalConstraint(
    waypointId: string,
    patch: Partial<WaypointVerticalConstraint>,
  ): void {
    if (!this.waypoints.some((waypoint) => waypoint.id === waypointId)) return;
    const existing = this.getWaypointVerticalConstraint(waypointId);
    const next: WaypointVerticalConstraint = {
      ...existing,
      ...patch,
      icaoCode: patch.icaoCode === undefined ? existing.icaoCode : normalizeIcao(patch.icaoCode),
    };

    if (!['auto', 'airport', 'circuits', 'none'].includes(next.mode)) return;
    if (next.mode === 'circuits' && !this.isAirportWaypoint(waypointId)) return;
    if (next.elevationFt !== null && (!Number.isFinite(next.elevationFt) || next.elevationFt < 0 || next.elevationFt > 20000)) return;
    if (!Number.isFinite(next.circuitCount) || next.circuitCount < 1 || next.circuitCount > 20) return;
    if (!Number.isFinite(next.minutesPerCircuit) || next.minutesPerCircuit < 1 || next.minutesPerCircuit > 30) return;

    next.elevationFt = next.elevationFt === null ? null : Math.round(next.elevationFt);
    next.circuitCount = Math.round(next.circuitCount);
    next.minutesPerCircuit = Math.round(next.minutesPerCircuit * 2) / 2;
    if (shallowEqual(existing, next)) return;

    this.rememberUndo();
    if (next.mode === 'auto' && next.elevationFt === null && next.icaoCode === '') {
      this.verticalWaypointConstraints.delete(waypointId);
    } else {
      this.verticalWaypointConstraints.set(waypointId, next);
    }
    this.emit();
  }

  setRouteWeatherForecasts(forecasts: LegWeatherForecast[]): void {
    this.weatherForecasts.clear();
    for (const forecast of forecasts) {
      this.weatherForecasts.set(this.legKey(forecast.fromId, forecast.toId), { ...forecast });
    }
    this.emit();
  }

  clearWeatherForecasts(): void {
    if (this.weatherForecasts.size === 0) return;
    this.weatherForecasts.clear();
    this.emit();
  }

  setPlannedAltitudeFt(fromId: string, toId: string, altitudeFt: number | null): void {
    const key = this.legKey(fromId, toId);
    const current = this.plannedAltitudesFt.get(key) ?? null;
    if (altitudeFt === null) {
      if (current === null) return;
      this.rememberUndo();
      this.plannedAltitudesFt.delete(key);
    } else {
      if (!Number.isFinite(altitudeFt) || altitudeFt < 0 || altitudeFt > 30000) return;
      const rounded = Math.round(altitudeFt);
      if (current === rounded) return;
      this.rememberUndo();
      this.plannedAltitudesFt.set(key, rounded);
    }
    // A new level also changes the estimated arrival time on subsequent legs.
    this.weatherForecasts.clear();
    this.emit();
  }

  getManualFrequency(fromId: string, toId: string): string | null {
    return this.manualFrequencies.get(this.legKey(fromId, toId)) ?? null;
  }

  setManualFrequency(fromId: string, toId: string, value: string | null): boolean {
    if (!this.getLegs().some(leg => leg.from.id === fromId && leg.to.id === toId)) return false;
    const key = this.legKey(fromId, toId);
    const normalized = value === null || value.trim() === '' ? null : normalizeManualChannels(value);
    if (value?.trim() && !normalized) return false;
    if ((this.manualFrequencies.get(key) ?? null) === normalized) return true;
    this.rememberUndo();
    if (normalized === null) this.manualFrequencies.delete(key); else this.manualFrequencies.set(key, normalized);
    this.emit();
    return true;
  }

  setManualMsaFt(fromId: string, toId: string, msaFt: number | null): void {
    const key = this.legKey(fromId, toId);
    const current = this.manualMsaFt.get(key) ?? null;
    if (msaFt === null) {
      if (current === null) return;
      this.rememberUndo();
      this.manualMsaFt.delete(key);
    } else {
      if (!Number.isFinite(msaFt) || msaFt < 0 || msaFt > 30000) return;
      const rounded = Math.round(msaFt);
      if (current === rounded) return;
      this.rememberUndo();
      this.manualMsaFt.set(key, rounded);
    }
    this.emit();
  }

  setManualLegWind(
    fromId: string,
    toId: string,
    wind: VerticalLegWind | null,
  ): void {
    const key = this.legKey(fromId, toId);
    const current = this.manualLegWinds.get(key) ?? null;
    if (wind === null) {
      if (current === null) return;
      this.rememberUndo();
      this.manualLegWinds.delete(key);
      this.emit();
      return;
    }

    if (
      !Number.isFinite(wind.windFromDeg) || wind.windFromDeg < 0 || wind.windFromDeg > 359 ||
      !Number.isFinite(wind.windSpeedKt) || wind.windSpeedKt < 0 || wind.windSpeedKt > 150
    ) {
      return;
    }

    const next: VerticalLegWind = {
      windFromDeg: Math.round(wind.windFromDeg) % 360,
      windSpeedKt: Math.round(wind.windSpeedKt),
    };
    if (current && shallowEqual(current, next)) return;

    this.rememberUndo();
    this.manualLegWinds.set(key, next);
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  addWaypoint(coordinate: Coordinate, name?: string): Waypoint {
    this.rememberUndo();
    const id = crypto.randomUUID();
    const hasCustomName = Boolean(name?.trim());
    const waypoint: Waypoint = {
      id,
      name: hasCustomName ? name!.trim() : '',
      ...coordinate,
    };

    if (!hasCustomName) this.automaticWaypointIds.add(id);
    this.waypoints = [...this.waypoints, waypoint];
    this.renumberAutomaticWaypointNames();
    this.weatherForecasts.clear();
    this.emit();
    return { ...this.waypoints[this.waypoints.length - 1] };
  }

  /** Append a published point sequence as one undoable action. */
  appendAipWaypoints(points: Array<Coordinate & { name: string; aipId: string; aipEffectiveDate: string; elevationFt?: number }>): void {
    if (points.length === 0 || points.some(point => !validCoordinate(point.lat, point.lon) || !point.name || !point.aipId || !/^\d{4}-\d{2}-\d{2}$/.test(point.aipEffectiveDate))) return;
    this.rememberUndo();
    for (const point of points) {
      const waypoint: Waypoint = { id: crypto.randomUUID(), name: point.name, lat: point.lat, lon: point.lon, aipId: point.aipId, aipEffectiveDate: point.aipEffectiveDate };
      this.waypoints.push(waypoint);
      if (point.elevationFt !== undefined) {
        this.verticalWaypointConstraints.set(waypoint.id, { ...DEFAULT_WAYPOINT_VERTICAL_CONSTRAINT, mode: 'airport', elevationFt: point.elevationFt, icaoCode: point.aipId });
        if (this.waypoints.length === 1) this.verticalProfileSettings = { ...this.verticalProfileSettings, departureElevationFt: point.elevationFt, departureIcaoCode: point.aipId };
        this.verticalProfileSettings = { ...this.verticalProfileSettings, destinationElevationFt: point.elevationFt, destinationIcaoCode: point.aipId };
      } else {
        // An appended reporting point is not a landing aerodrome.
        this.verticalProfileSettings = { ...this.verticalProfileSettings, destinationElevationFt: 0, destinationIcaoCode: '' };
      }
    }
    this.weatherForecasts.clear();
    this.emit();
  }

  insertWaypointAt(index: number, coordinate: Coordinate, name?: string): Waypoint | null {
    if (!Number.isInteger(index) || index <= 0 || index >= this.waypoints.length) return null;

    const from = this.waypoints[index - 1];
    const to = this.waypoints[index];
    const previousLegKey = this.legKey(from.id, to.id);
    const inheritedAltitudeFt = this.plannedAltitudesFt.get(previousLegKey) ?? null;
    const inheritedManualWind = this.manualLegWinds.get(previousLegKey) ?? null;

    this.rememberUndo();
    const id = crypto.randomUUID();
    const hasCustomName = Boolean(name?.trim());
    const waypoint: Waypoint = {
      id,
      name: hasCustomName ? name!.trim() : '',
      ...coordinate,
    };

    if (!hasCustomName) this.automaticWaypointIds.add(id);
    const nextWaypoints = [...this.waypoints];
    nextWaypoints.splice(index, 0, waypoint);
    this.waypoints = nextWaypoints;
    this.renumberAutomaticWaypointNames();

    this.plannedAltitudesFt.delete(previousLegKey);
    this.manualMsaFt.delete(previousLegKey);
    this.manualFrequencies.delete(previousLegKey);
    this.manualLegWinds.delete(previousLegKey);
    if (inheritedAltitudeFt !== null) {
      this.plannedAltitudesFt.set(this.legKey(from.id, id), inheritedAltitudeFt);
      this.plannedAltitudesFt.set(this.legKey(id, to.id), inheritedAltitudeFt);
    }
    if (inheritedManualWind !== null) {
      this.manualLegWinds.set(this.legKey(from.id, id), { ...inheritedManualWind });
      this.manualLegWinds.set(this.legKey(id, to.id), { ...inheritedManualWind });
    }
    this.weatherForecasts.clear();
    this.emit();

    const inserted = this.waypoints.find((item) => item.id === id);
    return inserted ? { ...inserted } : null;
  }

  updateWaypoint(id: string, patch: Partial<Omit<Waypoint, 'id'>>, publishedPoint?: PublishedMapPoint): void {
    const existing = this.waypoints.find((waypoint) => waypoint.id === id);
    if (!existing) return;
    if (publishedPoint) patch = { ...patch, lat: publishedPoint.lat, lon: publishedPoint.lon, name: publishedPoint.name, aipId: publishedPoint.aipId, aipEffectiveDate: publishedPoint.aipEffectiveDate };
    const changesAutomaticStatus = patch.name !== undefined && this.automaticWaypointIds.has(id);
    if (!changesAutomaticStatus && !hasPatchDifference(existing, patch)) return;

    this.rememberUndo();
    if (patch.name !== undefined) this.automaticWaypointIds.delete(id);
    const moved = (
      (patch.lat !== undefined && patch.lat !== existing.lat) ||
      (patch.lon !== undefined && patch.lon !== existing.lon)
    );
    const previousConstraint = this.verticalWaypointConstraints.get(id);
    if (moved) {
      this.clearManualLegSettingsForWaypoint(id);
      if (!publishedPoint) patch = { ...patch, aipId: undefined, aipEffectiveDate: undefined };
      if (previousConstraint?.mode === 'airport' || previousConstraint?.mode === 'circuits') this.verticalWaypointConstraints.delete(id);
    }
    this.waypoints = this.waypoints.map((waypoint) =>
      waypoint.id === id ? { ...waypoint, ...patch } : waypoint,
    );
    if (publishedPoint?.kind === 'airport') {
      this.verticalWaypointConstraints.set(id, { ...DEFAULT_WAYPOINT_VERTICAL_CONSTRAINT, ...previousConstraint,
        mode: previousConstraint?.mode === 'circuits' ? 'circuits' : 'airport', elevationFt: publishedPoint.elevationFt!, icaoCode: publishedPoint.aerodromeIcao });
    } else if (publishedPoint) this.verticalWaypointConstraints.delete(id);
    if (moved || publishedPoint) {
      const elevationFt = publishedPoint?.kind === 'airport' ? publishedPoint.elevationFt! : 0;
      const icaoCode = publishedPoint?.kind === 'airport' ? publishedPoint.aerodromeIcao : '';
      if (id === this.waypoints[0]?.id) this.verticalProfileSettings = { ...this.verticalProfileSettings, departureElevationFt: elevationFt, departureIcaoCode: icaoCode };
      if (id === this.waypoints.at(-1)?.id) this.verticalProfileSettings = { ...this.verticalProfileSettings, destinationElevationFt: elevationFt, destinationIcaoCode: icaoCode };
    }
    this.weatherForecasts.clear();
    this.emit();
  }

  removeWaypoint(id: string): void {
    if (!this.waypoints.some((waypoint) => waypoint.id === id)) return;
    this.rememberUndo();
    this.waypoints = this.waypoints.filter((waypoint) => waypoint.id !== id);
    this.automaticWaypointIds.delete(id);
    this.verticalWaypointConstraints.delete(id);
    this.renumberAutomaticWaypointNames();
    this.retainCurrentLegSettings();
    this.emit();
  }

  moveWaypoint(id: string, direction: -1 | 1): void {
    const index = this.waypoints.findIndex((waypoint) => waypoint.id === id);
    const nextIndex = index + direction;

    if (index < 0 || nextIndex < 0 || nextIndex >= this.waypoints.length) return;

    this.rememberUndo();
    const reordered = [...this.waypoints];
    [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
    this.waypoints = reordered;
    this.renumberAutomaticWaypointNames();
    this.retainCurrentLegSettings();
    this.emit();
  }

  clear(): void {
    if (this.waypoints.length === 0) return;
    this.rememberUndo();
    this.waypoints = [];
    this.automaticWaypointIds.clear();
    this.plannedAltitudesFt.clear();
    this.manualMsaFt.clear();
    this.manualFrequencies.clear();
    this.manualLegWinds.clear();
    this.weatherForecasts.clear();
    this.verticalWaypointConstraints.clear();
    this.emit();
  }

  private renumberAutomaticWaypointNames(): void {
    this.waypoints = this.waypoints.map((waypoint, index) =>
      this.automaticWaypointIds.has(waypoint.id)
        ? { ...waypoint, name: `WP${String(index + 1).padStart(2, '0')}` }
        : waypoint,
    );
  }

  private legKey(fromId: string, toId: string): string {
    return `${fromId}->${toId}`;
  }

  private clearManualLegSettingsForWaypoint(waypointId: string): void {
    const index = this.waypoints.findIndex((waypoint) => waypoint.id === waypointId);
    if (index < 0) return;
    const previous = this.waypoints[index - 1];
    const current = this.waypoints[index];
    const next = this.waypoints[index + 1];
    if (previous && current) {
      const key = this.legKey(previous.id, current.id);
      this.manualMsaFt.delete(key);
      this.manualFrequencies.delete(key);
      this.manualLegWinds.delete(key);
    }
    if (current && next) {
      const key = this.legKey(current.id, next.id);
      this.manualMsaFt.delete(key);
      this.manualFrequencies.delete(key);
      this.manualLegWinds.delete(key);
    }
  }

  private retainCurrentLegSettings(): void {
    const activeKeys = new Set(this.getLegs().map((leg) => this.legKey(leg.from.id, leg.to.id)));
    for (const key of this.plannedAltitudesFt.keys()) {
      if (!activeKeys.has(key)) this.plannedAltitudesFt.delete(key);
    }
    for (const key of this.manualFrequencies.keys()) {
      if (!activeKeys.has(key)) this.manualFrequencies.delete(key);
    }
    for (const key of this.manualMsaFt.keys()) {
      if (!activeKeys.has(key)) this.manualMsaFt.delete(key);
    }
    for (const key of this.manualLegWinds.keys()) {
      if (!activeKeys.has(key)) this.manualLegWinds.delete(key);
    }
    for (const key of this.weatherForecasts.keys()) {
      if (!activeKeys.has(key)) this.weatherForecasts.delete(key);
    }
    const activeWaypointIds = new Set(this.waypoints.map((waypoint) => waypoint.id));
    for (const waypointId of this.verticalWaypointConstraints.keys()) {
      if (!activeWaypointIds.has(waypointId)) this.verticalWaypointConstraints.delete(waypointId);
    }
  }

  private rememberUndo(): void {
    this.undoStack.push(this.createSnapshot());
    if (this.undoStack.length > MAX_UNDO_STEPS) this.undoStack.shift();
  }

  private createSnapshot(): FlightPlanSnapshot {
    return {
      waypoints: this.waypoints.map((waypoint) => ({ ...waypoint })),
      navigationSettings: { ...this.navigationSettings },
      performanceSettings: { ...this.performanceSettings },
      weatherSettings: { ...this.weatherSettings },
      verticalProfileSettings: { ...this.verticalProfileSettings },
      plannedAltitudesFt: [...this.plannedAltitudesFt.entries()],
      manualMsaFt: [...this.manualMsaFt.entries()],
      manualFrequencies: [...this.manualFrequencies.entries()],
      manualLegWinds: [...this.manualLegWinds.entries()].map(([key, wind]) => [key, { ...wind }]),
      weatherForecasts: [...this.weatherForecasts.entries()].map(([key, forecast]) => [key, { ...forecast }]),
      verticalWaypointConstraints: [...this.verticalWaypointConstraints.entries()].map(([key, constraint]) => [key, { ...constraint }]),
      automaticWaypointIds: [...this.automaticWaypointIds],
    };
  }

  private restoreSnapshot(snapshot: FlightPlanSnapshot): void {
    this.waypoints = snapshot.waypoints.map((waypoint) => ({ ...waypoint }));
    this.navigationSettings = { ...snapshot.navigationSettings };
    this.performanceSettings = { ...snapshot.performanceSettings };
    this.weatherSettings = { ...snapshot.weatherSettings };
    this.verticalProfileSettings = { ...snapshot.verticalProfileSettings };
    this.plannedAltitudesFt = new Map(snapshot.plannedAltitudesFt);
    this.manualMsaFt = new Map(snapshot.manualMsaFt);
    this.manualFrequencies = new Map(snapshot.manualFrequencies);
    this.manualLegWinds = new Map(
      snapshot.manualLegWinds.map(([key, wind]) => [key, { ...wind }]),
    );
    this.weatherForecasts = new Map(
      snapshot.weatherForecasts.map(([key, forecast]) => [key, { ...forecast }]),
    );
    this.verticalWaypointConstraints = new Map(
      snapshot.verticalWaypointConstraints.map(([key, constraint]) => [key, { ...constraint }]),
    );
    this.automaticWaypointIds = new Set(snapshot.automaticWaypointIds);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export function parseWorkingDraftState(value: unknown): FlightPlanWorkingDraftState | null {
  if (!isRecord(value)) return null;
  if (
    !Array.isArray(value.waypoints) ||
    !isNavigationSettings(value.navigationSettings) ||
    !isPerformanceSettings(value.performanceSettings) ||
    !isWeatherSettings(value.weatherSettings) ||
    !isVerticalProfileSettings(value.verticalProfileSettings) ||
    !Array.isArray(value.plannedAltitudesFt) ||
    !Array.isArray(value.manualMsaFt) ||
    !Array.isArray(value.manualLegWinds) ||
    !Array.isArray(value.verticalWaypointConstraints) ||
    !Array.isArray(value.automaticWaypointIds)
  ) return null;

  const waypoints: Waypoint[] = [];
  const waypointIds = new Set<string>();
  for (const item of value.waypoints) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0 || waypointIds.has(item.id)) return null;
    if (typeof item.name !== 'string' || !validCoordinate(item.lat, item.lon)) return null;
    const waypoint: Waypoint = { id: item.id, name: item.name, lat: item.lat as number, lon: item.lon as number };
    if (typeof item.aipId === 'string' && typeof item.aipEffectiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.aipEffectiveDate)) {
      waypoint.aipId = item.aipId;
      waypoint.aipEffectiveDate = item.aipEffectiveDate;
    }
    if (item.altitudeFt !== undefined) {
      if (!finiteInRange(item.altitudeFt, -2000, 60000)) return null;
      waypoint.altitudeFt = item.altitudeFt as number;
    }
    waypoints.push(waypoint);
    waypointIds.add(item.id);
  }

  const activeLegKeys = new Set(
    waypoints.slice(0, -1).map((waypoint, index) => `${waypoint.id}->${waypoints[index + 1].id}`),
  );

  const plannedAltitudesFt = parseNumberEntries(value.plannedAltitudesFt, activeLegKeys, 0, 30000);
  const manualMsaFt = parseNumberEntries(value.manualMsaFt, activeLegKeys, 0, 30000);
  if (!plannedAltitudesFt || !manualMsaFt) return null;

  // Older version-1 plans predate frequency overrides and remain importable.
  const manualFrequencies: Array<[string, string]> = [];
  if (value.manualFrequencies !== undefined && !Array.isArray(value.manualFrequencies)) return null;
  const seenFrequencies = new Set<string>();
  for (const entry of value.manualFrequencies ?? []) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !activeLegKeys.has(entry[0]) ||
        seenFrequencies.has(entry[0]) || typeof entry[1] !== 'string') return null;
    const channel = normalizeManualChannels(entry[1]);
    if (!channel) return null;
    seenFrequencies.add(entry[0]); manualFrequencies.push([entry[0], channel]);
  }

  const manualLegWinds: Array<[string, VerticalLegWind]> = [];
  for (const entry of value.manualLegWinds) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !activeLegKeys.has(entry[0])) return null;
    const wind = entry[1];
    if (!isRecord(wind) || !finiteInRange(wind.windFromDeg, 0, 359) || !finiteInRange(wind.windSpeedKt, 0, 150)) return null;
    manualLegWinds.push([entry[0], { windFromDeg: wind.windFromDeg as number, windSpeedKt: wind.windSpeedKt as number }]);
  }

  const verticalWaypointConstraints: Array<[string, WaypointVerticalConstraint]> = [];
  for (const entry of value.verticalWaypointConstraints) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !waypointIds.has(entry[0])) return null;
    const constraint = parseWaypointVerticalConstraint(entry[1]);
    if (!constraint) return null;
    verticalWaypointConstraints.push([entry[0], constraint]);
  }

  const automaticWaypointIds: string[] = [];
  for (const id of value.automaticWaypointIds) {
    if (typeof id !== 'string' || !waypointIds.has(id)) return null;
    automaticWaypointIds.push(id);
  }

  return {
    waypoints,
    navigationSettings: { ...value.navigationSettings } as NavigationSettings,
    performanceSettings: { ...value.performanceSettings } as PerformanceSettings,
    weatherSettings: { ...value.weatherSettings } as WeatherSettings,
    verticalProfileSettings: { ...value.verticalProfileSettings } as VerticalProfileSettings,
    plannedAltitudesFt,
    manualMsaFt,
    manualFrequencies,
    manualLegWinds,
    verticalWaypointConstraints,
    automaticWaypointIds,
  };
}

function parseNumberEntries(
  value: unknown[],
  activeKeys: Set<string>,
  min: number,
  max: number,
): Array<[string, number]> | null {
  const result: Array<[string, number]> = [];
  for (const entry of value) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      !activeKeys.has(entry[0]) ||
      !finiteInRange(entry[1], min, max)
    ) return null;
    result.push([entry[0], entry[1] as number]);
  }
  return result;
}

function parseWaypointVerticalConstraint(value: unknown): WaypointVerticalConstraint | null {
  if (!isRecord(value)) return null;
  if (typeof value.mode !== 'string' || !['auto', 'airport', 'circuits', 'none'].includes(value.mode)) return null;
  if (value.elevationFt !== null && !finiteInRange(value.elevationFt, 0, 20000)) return null;
  if (typeof value.icaoCode !== 'string') return null;
  if (!finiteInRange(value.circuitCount, 1, 20) || !finiteInRange(value.minutesPerCircuit, 1, 30)) return null;
  return {
    mode: value.mode as WaypointVerticalMode,
    elevationFt: value.elevationFt as number | null,
    icaoCode: normalizeIcao(value.icaoCode),
    circuitCount: value.circuitCount as number,
    minutesPerCircuit: value.minutesPerCircuit as number,
  };
}

function isNavigationSettings(value: unknown): value is NavigationSettings {
  return isRecord(value) &&
    finiteInRange(value.tasKt, 1, 400) &&
    finiteInRange(value.windFromDeg, 0, 359) &&
    finiteInRange(value.windSpeedKt, 0, 200) &&
    finiteInRange(value.variationDegEast, -180, 180) &&
    typeof value.automaticVariation === 'boolean';
}

function isPerformanceSettings(value: unknown): value is PerformanceSettings {
  return isRecord(value) &&
    typeof value.usePohPerformance === 'boolean' &&
    finiteInRange(value.pressureAltitudeFt, 0, 14000) &&
    finiteInRange(value.oatC, -60, 50) &&
    finiteInRange(value.rpm, 2000, 2400) &&
    finiteInRange(value.manifoldPressureInHg, 15, 27);
}

function isWeatherSettings(value: unknown): value is WeatherSettings {
  return isRecord(value) &&
    typeof value.useForecastWinds === 'boolean' &&
    typeof value.departureTimeUtc === 'string';
}

function isVerticalProfileSettings(value: unknown): value is VerticalProfileSettings {
  return isRecord(value) &&
    finiteInRange(value.departureElevationFt, 0, 20000) &&
    finiteInRange(value.destinationElevationFt, 0, 20000) &&
    typeof value.departureIcaoCode === 'string' &&
    typeof value.destinationIcaoCode === 'string' &&
    finiteInRange(value.climbRateFpm, 1, 5000) &&
    finiteInRange(value.descentRateFpm, 1, 5000) &&
    finiteInRange(value.climbGroundSpeedKt, 1, 300) &&
    finiteInRange(value.descentGroundSpeedKt, 1, 300) &&
    (value.climbSpeedMode === undefined || value.climbSpeedMode === 'tas' || value.climbSpeedMode === 'ias') &&
    (value.descentSpeedMode === undefined || value.descentSpeedMode === 'manual' || value.descentSpeedMode === 'cruise');
}

function validCoordinate(lat: unknown, lon: unknown): boolean {
  return finiteInRange(lat, -90, 90) && finiteInRange(lon, -180, 180);
}

function finiteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasPatchDifference<T extends object>(current: T, patch: Partial<T>): boolean {
  return Object.entries(patch).some(([key, value]) => current[key as keyof T] !== value);
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as Array<keyof T>;
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function normalizeIcao(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

function manualWindValidTime(value: string): string {
  if (!value) return new Date().toISOString();
  const suffix = value.endsWith('Z') ? '' : ':00Z';
  return `${value}${suffix}`;
}

function nextWholeUtcHour(): string {
  const date = new Date();
  date.setUTCMinutes(0, 0, 0);
  date.setUTCHours(date.getUTCHours() + 1);
  return date.toISOString().slice(0, 16);
}
