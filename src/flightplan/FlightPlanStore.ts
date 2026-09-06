import type { Coordinate, RouteLeg, Waypoint } from '../types';
import { calculateRouteLegs } from '../navigation/geodesy';

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

export interface VerticalProfileSettings {
  departureElevationFt: number;
  destinationElevationFt: number;
  departureIcaoCode: string;
  destinationIcaoCode: string;
  climbRateFpm: number;
  descentRateFpm: number;
  climbGroundSpeedKt: number;
  descentGroundSpeedKt: number;
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
  rpm: 2300,
  manifoldPressureInHg: 23,
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

export class FlightPlanStore {
  private waypoints: Waypoint[] = [];
  private navigationSettings: NavigationSettings = { ...DEFAULT_NAVIGATION_SETTINGS };
  private performanceSettings: PerformanceSettings = { ...DEFAULT_PERFORMANCE_SETTINGS };
  private weatherSettings: WeatherSettings = { ...DEFAULT_WEATHER_SETTINGS };
  private verticalProfileSettings: VerticalProfileSettings = { ...DEFAULT_VERTICAL_PROFILE_SETTINGS };
  private plannedAltitudesFt = new Map<string, number>();
  private weatherForecasts = new Map<string, LegWeatherForecast>();
  private verticalWaypointConstraints = new Map<string, WaypointVerticalConstraint>();
  private automaticWaypointIds = new Set<string>();
  private listeners = new Set<Listener>();

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
    return { ...this.verticalProfileSettings };
  }

  getWaypointVerticalConstraint(waypointId: string): WaypointVerticalConstraint {
    const constraint = this.verticalWaypointConstraints.get(waypointId);
    return constraint ? { ...constraint } : { ...DEFAULT_WAYPOINT_VERTICAL_CONSTRAINT };
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

  getLegWeatherForecast(fromId: string, toId: string): LegWeatherForecast | null {
    const forecast = this.weatherForecasts.get(this.legKey(fromId, toId));
    return forecast ? { ...forecast } : null;
  }

  getWeatherForecasts(): LegWeatherForecast[] {
    return this.getLegs()
      .map((leg) => this.getLegWeatherForecast(leg.from.id, leg.to.id))
      .filter((forecast): forecast is LegWeatherForecast => forecast !== null);
  }

  updateNavigationSettings(patch: Partial<NavigationSettings>): void {
    this.navigationSettings = { ...this.navigationSettings, ...patch };
    this.emit();
  }

  updatePerformanceSettings(patch: Partial<PerformanceSettings>): void {
    this.performanceSettings = { ...this.performanceSettings, ...patch };
    this.emit();
  }

  updateWeatherSettings(patch: Partial<WeatherSettings>): void {
    this.weatherSettings = { ...this.weatherSettings, ...patch };
    this.emit();
  }

  updateVerticalProfileSettings(patch: Partial<VerticalProfileSettings>): void {
    const next: VerticalProfileSettings = {
      ...this.verticalProfileSettings,
      ...patch,
      departureIcaoCode: patch.departureIcaoCode === undefined
        ? this.verticalProfileSettings.departureIcaoCode
        : normalizeIcao(patch.departureIcaoCode),
      destinationIcaoCode: patch.destinationIcaoCode === undefined
        ? this.verticalProfileSettings.destinationIcaoCode
        : normalizeIcao(patch.destinationIcaoCode),
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
    if (next.elevationFt !== null && (!Number.isFinite(next.elevationFt) || next.elevationFt < 0 || next.elevationFt > 20000)) return;
    if (!Number.isFinite(next.circuitCount) || next.circuitCount < 1 || next.circuitCount > 20) return;
    if (!Number.isFinite(next.minutesPerCircuit) || next.minutesPerCircuit < 1 || next.minutesPerCircuit > 30) return;

    next.elevationFt = next.elevationFt === null ? null : Math.round(next.elevationFt);
    next.circuitCount = Math.round(next.circuitCount);
    next.minutesPerCircuit = Math.round(next.minutesPerCircuit * 2) / 2;

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
    if (altitudeFt === null) {
      this.plannedAltitudesFt.delete(key);
    } else {
      if (!Number.isFinite(altitudeFt) || altitudeFt < 0 || altitudeFt > 30000) {
        return;
      }
      this.plannedAltitudesFt.set(key, Math.round(altitudeFt));
    }
    this.weatherForecasts.delete(key);
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  addWaypoint(coordinate: Coordinate, name?: string): Waypoint {
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

  updateWaypoint(id: string, patch: Partial<Omit<Waypoint, 'id'>>): void {
    if (patch.name !== undefined) this.automaticWaypointIds.delete(id);
    this.waypoints = this.waypoints.map((waypoint) =>
      waypoint.id === id ? { ...waypoint, ...patch } : waypoint,
    );
    this.weatherForecasts.clear();
    this.emit();
  }

  removeWaypoint(id: string): void {
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

    if (index < 0 || nextIndex < 0 || nextIndex >= this.waypoints.length) {
      return;
    }

    const reordered = [...this.waypoints];
    [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
    this.waypoints = reordered;
    this.renumberAutomaticWaypointNames();
    this.retainCurrentLegSettings();
    this.emit();
  }

  clear(): void {
    if (this.waypoints.length === 0) {
      return;
    }
    this.waypoints = [];
    this.automaticWaypointIds.clear();
    this.plannedAltitudesFt.clear();
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

  private retainCurrentLegSettings(): void {
    const activeKeys = new Set(
      this.getLegs().map((leg) => this.legKey(leg.from.id, leg.to.id)),
    );
    for (const key of this.plannedAltitudesFt.keys()) {
      if (!activeKeys.has(key)) {
        this.plannedAltitudesFt.delete(key);
      }
    }
    for (const key of this.weatherForecasts.keys()) {
      if (!activeKeys.has(key)) {
        this.weatherForecasts.delete(key);
      }
    }
    const activeWaypointIds = new Set(this.waypoints.map((waypoint) => waypoint.id));
    for (const waypointId of this.verticalWaypointConstraints.keys()) {
      if (!activeWaypointIds.has(waypointId)) {
        this.verticalWaypointConstraints.delete(waypointId);
      }
    }
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

function normalizeIcao(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

function nextWholeUtcHour(): string {
  const date = new Date();
  date.setUTCMinutes(0, 0, 0);
  date.setUTCHours(date.getUTCHours() + 1);
  return date.toISOString().slice(0, 16);
}
