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

export class FlightPlanStore {
  private waypoints: Waypoint[] = [];
  private navigationSettings: NavigationSettings = { ...DEFAULT_NAVIGATION_SETTINGS };
  private performanceSettings: PerformanceSettings = { ...DEFAULT_PERFORMANCE_SETTINGS };
  private plannedAltitudesFt = new Map<string, number>();
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

  getPlannedAltitudeFt(fromId: string, toId: string): number | null {
    return this.plannedAltitudesFt.get(this.legKey(fromId, toId)) ?? null;
  }

  updateNavigationSettings(patch: Partial<NavigationSettings>): void {
    this.navigationSettings = { ...this.navigationSettings, ...patch };
    this.emit();
  }

  updatePerformanceSettings(patch: Partial<PerformanceSettings>): void {
    this.performanceSettings = { ...this.performanceSettings, ...patch };
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
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  addWaypoint(coordinate: Coordinate, name?: string): Waypoint {
    const waypoint: Waypoint = {
      id: crypto.randomUUID(),
      name: name?.trim() || `WP${String(this.waypoints.length + 1).padStart(2, '0')}`,
      ...coordinate,
    };

    this.waypoints = [...this.waypoints, waypoint];
    this.emit();
    return { ...waypoint };
  }

  updateWaypoint(id: string, patch: Partial<Omit<Waypoint, 'id'>>): void {
    this.waypoints = this.waypoints.map((waypoint) =>
      waypoint.id === id ? { ...waypoint, ...patch } : waypoint,
    );
    this.emit();
  }

  removeWaypoint(id: string): void {
    this.waypoints = this.waypoints.filter((waypoint) => waypoint.id !== id);
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
    this.retainCurrentLegSettings();
    this.emit();
  }

  clear(): void {
    if (this.waypoints.length === 0) {
      return;
    }
    this.waypoints = [];
    this.plannedAltitudesFt.clear();
    this.emit();
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
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
