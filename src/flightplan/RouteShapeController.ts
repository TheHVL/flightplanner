import type { Coordinate, RouteLeg } from '../types';
import type { FlightPlanStore } from './FlightPlanStore';
import { calculateRouteLegs, routeLegKey } from '../navigation/geodesy';

export const ROUTE_SHAPE_CHANGED_EVENT = 'flightplanner-route-shape-changed';

export interface RouteShapeDraft {
  fromId: string;
  toId: string;
  coordinate: Coordinate;
}

/**
 * Keeps route-shaping bends separate from navigation waypoints.
 * A bend changes plotted/flown distance while the leg's TT remains the direct
 * waypoint-to-waypoint track. This is intentionally a distance-routing aid,
 * not a new OFP navigation point.
 */
export class RouteShapeController {
  private readonly shapes = new Map<string, Coordinate>();
  private immediateUndo = false;
  private applyingSideEffects = false;

  constructor(private readonly store: FlightPlanStore) {
    // Route calculations throughout the existing application call store.getLegs().
    // Replacing this instance method lets every consumer see shaped distance while
    // keeping the route-shape state deliberately separate from named waypoints.
    this.store.getLegs = (): RouteLeg[] => calculateRouteLegs(this.store.getWaypoints(), this.shapes);

    this.store.attachRouteShapeHistory(() => this.getShapeDraft(), shapes => {
      this.shapes.clear();
      for (const shape of shapes) this.shapes.set(routeLegKey(shape.fromId, shape.toId), { ...shape.coordinate });
      this.immediateUndo = false;
    });
    this.store.subscribe(() => {
      this.pruneInvalidShapes();
      if (!this.applyingSideEffects) this.immediateUndo = false;
    });
  }

  setLegShape(legIndex: number, coordinate: Coordinate): boolean {
    const legs = this.store.getLegs();
    const leg = legs[legIndex];
    if (!leg || !isValidCoordinate(coordinate)) return false;

    const key = routeLegKey(leg.from.id, leg.to.id);
    const previousShape = this.shapes.get(key) ?? null;
    if (
      previousShape &&
      Math.abs(previousShape.lat - coordinate.lat) < 1e-9 &&
      Math.abs(previousShape.lon - coordinate.lon) < 1e-9
    ) return false;

    this.applyingSideEffects = true;
    try {
      this.store.runUndoableAction(() => {
        this.shapes.set(key, { ...coordinate });
        // The changed corridor invalidates its previous manual MSA and weather.
        if (this.store.getManualMsaFt(leg.from.id, leg.to.id) !== null) this.store.setManualMsaFt(leg.from.id, leg.to.id, null);
        this.store.clearWeatherForecasts();
      });
    } finally { this.applyingSideEffects = false; }
    this.immediateUndo = true;
    this.emit();
    return true;
  }

  clearLegShape(fromId: string, toId: string): boolean {
    const key = routeLegKey(fromId, toId);
    if (!this.shapes.has(key)) return false;
    this.store.runUndoableAction(() => {
      this.shapes.delete(key);
      this.store.setManualMsaFt(fromId, toId, null);
      this.store.clearWeatherForecasts();
    });
    this.immediateUndo = false;
    this.emit();
    return true;
  }

  canUndoImmediateShape(): boolean {
    return this.immediateUndo;
  }

  undoImmediateShape(): boolean {
    if (!this.immediateUndo) return false;
    this.immediateUndo = false;
    return this.store.undoLastAction();
  }

  getShapeDraft(): RouteShapeDraft[] {
    return [...this.shapes.entries()]
      .map(([key, coordinate]) => {
        const [fromId, toId] = key.split('->');
        return fromId && toId ? { fromId, toId, coordinate: { ...coordinate } } : null;
      })
      .filter((shape): shape is RouteShapeDraft => shape !== null);
  }

  restoreShapeDraft(value: unknown): boolean {
    if (!Array.isArray(value)) return false;

    const waypoints = this.store.getWaypoints();
    const activeKeys = new Set(
      waypoints
        .slice(0, -1)
        .map((waypoint, index) => routeLegKey(waypoint.id, waypoints[index + 1].id)),
    );
    const restored = new Map<string, Coordinate>();

    for (const item of value) {
      if (
        typeof item !== 'object' ||
        item === null ||
        !('fromId' in item) ||
        !('toId' in item) ||
        !('coordinate' in item)
      ) return false;

      const fromId = (item as { fromId?: unknown }).fromId;
      const toId = (item as { toId?: unknown }).toId;
      const coordinate = (item as { coordinate?: unknown }).coordinate;
      if (typeof fromId !== 'string' || typeof toId !== 'string') return false;
      if (typeof coordinate !== 'object' || coordinate === null) return false;

      const lat = (coordinate as { lat?: unknown }).lat;
      const lon = (coordinate as { lon?: unknown }).lon;
      if (typeof lat !== 'number' || typeof lon !== 'number' || !isValidCoordinate({ lat, lon })) return false;

      const key = routeLegKey(fromId, toId);
      if (!activeKeys.has(key)) return false;
      restored.set(key, { lat, lon });
    }

    this.shapes.clear();
    for (const [key, coordinate] of restored) this.shapes.set(key, coordinate);
    this.immediateUndo = false;
    this.emit();
    return true;
  }

  clearAllShapes(): void {
    if (this.shapes.size === 0) return;
    this.store.runUndoableAction(() => {
      this.shapes.clear();
      for (const leg of this.store.getLegs()) this.store.setManualMsaFt(leg.from.id, leg.to.id, null);
      this.store.clearWeatherForecasts();
    });
    this.immediateUndo = false;
    this.emit();
  }

  hasAnyShapes(): boolean {
    return this.shapes.size > 0;
  }

  private pruneInvalidShapes(): void {
    const waypoints = this.store.getWaypoints();
    const activeKeys = new Set(
      waypoints.slice(0, -1).map((waypoint, index) => routeLegKey(waypoint.id, waypoints[index + 1].id)),
    );
    let changed = false;
    for (const key of this.shapes.keys()) {
      if (!activeKeys.has(key)) {
        this.shapes.delete(key);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  private emit(): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ROUTE_SHAPE_CHANGED_EVENT));
  }
}

function isValidCoordinate(coordinate: Coordinate): boolean {
  return Number.isFinite(coordinate.lat) &&
    Number.isFinite(coordinate.lon) &&
    coordinate.lat >= -90 && coordinate.lat <= 90 &&
    coordinate.lon >= -180 && coordinate.lon <= 180;
}
