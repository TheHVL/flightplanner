import type { Coordinate, RouteLeg } from '../types';
import type { FlightPlanStore, LegWeatherForecast } from './FlightPlanStore';
import { calculateRouteLegs, routeLegKey } from '../navigation/geodesy';

export const ROUTE_SHAPE_CHANGED_EVENT = 'flightplanner-route-shape-changed';

interface ShapeUndo {
  key: string;
  previousShape: Coordinate | null;
  previousMsaFt: number | null;
  previousForecasts: LegWeatherForecast[];
}

/**
 * Keeps route-shaping bends separate from navigation waypoints.
 * A bend changes plotted/flown distance while the leg's TT remains the direct
 * waypoint-to-waypoint track. This is intentionally a distance-routing aid,
 * not a new OFP navigation point.
 */
export class RouteShapeController {
  private readonly shapes = new Map<string, Coordinate>();
  private immediateUndo: ShapeUndo | null = null;
  private applyingSideEffects = false;

  constructor(private readonly store: FlightPlanStore) {
    // Route calculations throughout the existing application call store.getLegs().
    // Replacing this instance method lets every consumer see shaped distance while
    // keeping the route-shape state deliberately separate from named waypoints.
    this.store.getLegs = (): RouteLeg[] => calculateRouteLegs(this.store.getWaypoints(), this.shapes);

    this.store.subscribe(() => {
      this.pruneInvalidShapes();
      if (!this.applyingSideEffects) this.immediateUndo = null;
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

    const previousMsaFt = this.store.getManualMsaFt(leg.from.id, leg.to.id);
    const previousForecasts = this.store.getWeatherForecasts();
    this.shapes.set(key, { ...coordinate });

    this.applyingSideEffects = true;
    try {
      // The flown corridor and timing geometry changed, so a manual MSA checked
      // against the old path and route-weather samples are no longer trusted.
      if (previousMsaFt !== null) this.store.setManualMsaFt(leg.from.id, leg.to.id, null);
      this.store.clearWeatherForecasts();
    } finally {
      this.applyingSideEffects = false;
    }

    this.immediateUndo = { key, previousShape, previousMsaFt, previousForecasts };
    this.emit();
    return true;
  }

  clearLegShape(fromId: string, toId: string): boolean {
    const key = routeLegKey(fromId, toId);
    if (!this.shapes.has(key)) return false;
    this.shapes.delete(key);
    this.immediateUndo = null;
    this.emit();
    return true;
  }

  canUndoImmediateShape(): boolean {
    return this.immediateUndo !== null;
  }

  undoImmediateShape(): boolean {
    const undo = this.immediateUndo;
    if (!undo) return false;
    this.immediateUndo = null;

    if (undo.previousShape) this.shapes.set(undo.key, { ...undo.previousShape });
    else this.shapes.delete(undo.key);

    const [fromId, toId] = undo.key.split('->');
    this.applyingSideEffects = true;
    try {
      if (fromId && toId && undo.previousMsaFt !== null) {
        this.store.setManualMsaFt(fromId, toId, undo.previousMsaFt);
      }
      if (undo.previousForecasts.length > 0) {
        this.store.setRouteWeatherForecasts(undo.previousForecasts);
      }
    } finally {
      this.applyingSideEffects = false;
    }

    this.emit();
    return true;
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
