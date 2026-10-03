import type { FlightPlanStore, FlightPlanWorkingDraftState } from './FlightPlanStore';
import type { RouteShapeController, RouteShapeDraft } from './RouteShapeController';

const STORAGE_KEY = 'flightplanner-working-route-v1';
const SCHEMA_VERSION = 1;

interface StoredWorkingRoute {
  schemaVersion: 1;
  savedAtUtc: string;
  flightPlan: FlightPlanWorkingDraftState;
  routeShapes: RouteShapeDraft[];
}

export function saveWorkingRoute(
  store: FlightPlanStore,
  routeShapes: RouteShapeController,
): boolean {
  if (typeof window === 'undefined') return false;

  try {
    if (store.getWaypoints().length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      return true;
    }

    const payload: StoredWorkingRoute = {
      schemaVersion: SCHEMA_VERSION,
      savedAtUtc: new Date().toISOString(),
      flightPlan: store.exportWorkingDraftState(),
      routeShapes: routeShapes.getShapeDraft(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function restoreWorkingRoute(
  store: FlightPlanStore,
  routeShapes: RouteShapeController,
): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredWorkingRoute(parsed)) return false;

    if (!store.restoreWorkingDraftState(parsed.flightPlan)) return false;
    if (!routeShapes.restoreShapeDraft(parsed.routeShapes)) {
      store.clear();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function clearWorkingRoute(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Local storage can be unavailable in private/restricted browser contexts.
  }
}

function isStoredWorkingRoute(value: unknown): value is StoredWorkingRoute {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === SCHEMA_VERSION &&
    typeof record.savedAtUtc === 'string' &&
    typeof record.flightPlan === 'object' &&
    record.flightPlan !== null &&
    Array.isArray(record.routeShapes);
}
