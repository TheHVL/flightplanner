import { FlightPlanStore, parseWorkingDraftState, type FlightPlanWorkingDraftState } from './FlightPlanStore';
import type { RouteShapeController, RouteShapeDraft } from './RouteShapeController';
import { getFuelPlanningSettings, saveFuelPlanningSettings, type FuelPlanningSettings } from '../fuel/fuelPlanning';

const STORAGE_KEY = 'flightplanner-saved-plans-v1';
const PREVIOUS_KEY = 'flightplanner-previous-plan-v1';
export const MAX_PLAN_FILE_BYTES = 2 * 1024 * 1024;

export interface PlanSnapshot {
  flightPlan: FlightPlanWorkingDraftState;
  routeShapes: RouteShapeDraft[];
  fuelSettings: FuelPlanningSettings;
}

export interface SavedPlan extends PlanSnapshot {
  kind: 'flightplanner-plan';
  schemaVersion: 1;
  id: string;
  name: string;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export function capturePlan(store: FlightPlanStore, shapes: RouteShapeController): PlanSnapshot {
  return clone({ flightPlan: store.exportWorkingDraftState(), routeShapes: shapes.getShapeDraft(), fuelSettings: getFuelPlanningSettings() });
}

export function createPlan(name: string, snapshot: PlanSnapshot): SavedPlan {
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 100) throw new Error('Enter a plan name of 1 to 100 characters.');
  const validated = parseSnapshot(snapshot);
  if (!validated || validated.flightPlan.waypoints.length === 0) throw new Error('Add at least one waypoint before saving or exporting a plan.');
  const now = new Date().toISOString();
  return { kind: 'flightplanner-plan', schemaVersion: 1, id: crypto.randomUUID(), name: normalizedName, createdAtUtc: now, updatedAtUtc: now, ...validated };
}

export function parsePlanFile(contents: string): SavedPlan {
  if (new Blob([contents]).size > MAX_PLAN_FILE_BYTES) throw new Error('The plan file is too large (maximum 2 MB).');
  let value: unknown;
  try { value = JSON.parse(contents); } catch { throw new Error('This file is not valid JSON.'); }
  const plan = parseSavedPlan(value);
  if (!plan) throw new Error('This is not a valid Flightplanner plan file, or its version is unsupported.');
  return plan;
}

/** Explicit snapshots. Editing the working route never overwrites a saved plan. */
export class SavedPlanRepository {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'>) {}

  list(): SavedPlan[] {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const value = JSON.parse(raw);
      if (value.schemaVersion !== 1 || !Array.isArray(value.plans) || value.plans.length > 100) throw new Error();
      const plans = value.plans.map(parseSavedPlan);
      if (plans.some((plan: SavedPlan | null) => !plan) || new Set(plans.map((plan: SavedPlan) => plan.id)).size !== plans.length) throw new Error();
      return plans.sort((a: SavedPlan, b: SavedPlan) => a.name.localeCompare(b.name));
    } catch {
      throw new Error('Saved plans could not be read. Existing saved data has been kept.');
    }
  }

  save(name: string, snapshot: PlanSnapshot, existingId?: string): SavedPlan {
    const plans = this.list();
    const previous = existingId ? plans.find((plan) => plan.id === existingId) : undefined;
    if (existingId && !previous) throw new Error('The selected plan no longer exists.');
    const plan = createPlan(name, snapshot);
    if (previous) { plan.id = previous.id; plan.createdAtUtc = previous.createdAtUtc; }
    else if (plans.length >= 100) throw new Error('You have 100 saved plans. Remove one before saving another.');
    if (plans.some((item) => item.id !== plan.id && item.name.toLocaleLowerCase() === plan.name.toLocaleLowerCase())) {
      throw new Error('A plan already has this name. Choose another name or update that saved plan.');
    }
    this.write([...plans.filter((item) => item.id !== plan.id), plan]);
    return clone(plan);
  }

  duplicate(id: string): SavedPlan {
    const plans = this.list();
    const source = plans.find((plan) => plan.id === id);
    if (!source) throw new Error('Select a saved plan to duplicate.');
    return this.save(this.availableName(`${source.name.slice(0, 85)} copy`, plans), source);
  }

  importFile(contents: string): SavedPlan {
    const source = parsePlanFile(contents);
    return this.save(this.availableName(source.name, this.list()), source);
  }

  remove(id: string): void {
    this.write(this.list().filter((plan) => plan.id !== id));
  }

  hasPrevious(): boolean { return this.storage.getItem(PREVIOUS_KEY) !== null; }

  load(plan: PlanSnapshot, store: FlightPlanStore, shapes: RouteShapeController): void {
    const validated = parseSnapshot(plan);
    if (!validated) throw new Error('The plan contains invalid planning data. Your current plan has been kept.');
    // Write the recovery point before changing the working route. A storage
    // failure aborts the load, rather than silently losing unsaved work.
    this.storePrevious(capturePlan(store, shapes));
    applySnapshot(validated, store, shapes);
  }

  restorePrevious(store: FlightPlanStore, shapes: RouteShapeController): void {
    const raw = this.storage.getItem(PREVIOUS_KEY);
    let previous: PlanSnapshot | null = null;
    try { previous = raw ? parseSnapshot(JSON.parse(raw)) : null; } catch { /* Kept intact for recovery. */ }
    if (!previous) throw new Error('No readable previous working plan is available.');
    this.load(previous, store, shapes);
  }

  private storePrevious(snapshot: PlanSnapshot): void {
    try { this.storage.setItem(PREVIOUS_KEY, JSON.stringify(snapshot)); }
    catch { throw new Error('Could not keep a recovery copy. Your current plan has been kept. Export it before switching plans.'); }
  }

  private write(plans: SavedPlan[]): void {
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, plans })); }
    catch { throw new Error('Could not save in this browser. Storage may be full or unavailable. Export your current plan to keep a file copy.'); }
  }

  private availableName(name: string, plans: SavedPlan[]): string {
    let candidate = name;
    for (let number = 2; plans.some((plan) => plan.name.toLocaleLowerCase() === candidate.toLocaleLowerCase()); number++) {
      candidate = `${name.slice(0, 90)} (${number})`;
    }
    return candidate;
  }
}

function applySnapshot(snapshot: PlanSnapshot, store: FlightPlanStore, shapes: RouteShapeController): void {
  // This is the only write that can fail; perform it before mutating the route.
  try { saveFuelPlanningSettings(snapshot.fuelSettings, { requireStorage: true }); }
  catch { throw new Error('Could not restore fuel settings. Your current route has been kept.'); }
  store.restoreWorkingDraftState(snapshot.flightPlan);
  shapes.restoreShapeDraft(snapshot.routeShapes);
}

function parseSavedPlan(value: unknown): SavedPlan | null {
  if (!isRecord(value) || value.kind !== 'flightplanner-plan' || value.schemaVersion !== 1 ||
      typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' ||
      !value.name.trim() || value.name.length > 100 || !validDate(value.createdAtUtc) || !validDate(value.updatedAtUtc)) return null;
  const snapshot = parseSnapshot(value);
  if (!snapshot || !snapshot.flightPlan.waypoints.length) return null;
  return { kind: 'flightplanner-plan', schemaVersion: 1, id: value.id, name: value.name.trim(), createdAtUtc: value.createdAtUtc as string, updatedAtUtc: value.updatedAtUtc as string, ...snapshot };
}

function parseSnapshot(value: unknown): PlanSnapshot | null {
  if (!isRecord(value)) return null;
  const flightPlan = parseWorkingDraftState(value.flightPlan);
  if (!flightPlan || flightPlan.waypoints.length > 500 || !Array.isArray(value.routeShapes) || !validFuelSettings(value.fuelSettings)) return null;
  // Waypoint IDs become data attributes and leg keys throughout the planner.
  if (flightPlan.waypoints.some((point) => !/^[A-Za-z0-9_-]{1,100}$/.test(point.id))) return null;
  const keys = new Set(flightPlan.waypoints.slice(0, -1).map((point, index) => `${point.id}->${flightPlan.waypoints[index + 1].id}`));
  const seen = new Set<string>();
  const routeShapes: RouteShapeDraft[] = [];
  for (const shape of value.routeShapes) {
    if (!isRecord(shape) || typeof shape.fromId !== 'string' || typeof shape.toId !== 'string' || !isRecord(shape.coordinate)) return null;
    const key = `${shape.fromId}->${shape.toId}`;
    if (!keys.has(key) || seen.has(key) || !inRange(shape.coordinate.lat, -90, 90) || !inRange(shape.coordinate.lon, -180, 180)) return null;
    seen.add(key);
    routeShapes.push({ fromId: shape.fromId, toId: shape.toId, coordinate: { lat: shape.coordinate.lat, lon: shape.coordinate.lon } });
  }
  return clone({ flightPlan, routeShapes, fuelSettings: value.fuelSettings });
}

function validFuelSettings(value: unknown): value is FuelPlanningSettings {
  if (!isRecord(value) || !inRange(value.startupTaxiTakeoffGal, 0, 20) || typeof value.climbPerformanceMode !== 'string' ||
      !['manual', 'poh-max-rate', 'poh-normal-90'].includes(String(value.climbPerformanceMode))) return false;
  if (value.reserveGal !== undefined && !inRange(value.reserveGal, 0, 100)) return false;
  if (value.contingencyGal !== undefined && value.contingencyGal !== null && !inRange(value.contingencyGal, 0, 100)) return false;
  return ['manualCruiseFuelFlowGph', 'climbFuelFlowGph', 'descentFuelFlowGph', 'circuitFuelFlowGph', 'totalFuelOnboardGal']
    .every((key) => value[key] === null || inRange(value[key], 0, key === 'totalFuelOnboardGal' ? 100 : 40));
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function validDate(value: unknown): boolean { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
