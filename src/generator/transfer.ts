import { parseWorkingDraftState, type FlightPlanWorkingDraftState } from '../flightplan/FlightPlanStore';
import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import type { RouteShapeController } from '../flightplan/RouteShapeController';
import { createPlan, parsePlanFile, SavedPlanRepository } from '../flightplan/savedPlans';
import { DEFAULT_FUEL_PLANNING_SETTINGS, type FuelPlanningSettings } from '../fuel/fuelPlanning';

const TRANSFER_KEY = 'flightplanner-generator-transfer-v1';
const MAX_AGE_MS = 30 * 60 * 1000;
/** Staging touches session storage only, never the manual working route or saved plans. */
export function stageGeneratedRoute(draft: FlightPlanWorkingDraftState, storage: Pick<Storage, 'setItem'>, now = Date.now(), fuelSettings: FuelPlanningSettings = DEFAULT_FUEL_PLANNING_SETTINGS): string {
  const validated = parseWorkingDraftState(draft);
  if (!validated || validated.waypoints.length < 2) throw new Error('This generated draft cannot be transferred.');
  const token = crypto.randomUUID();
  const plan = createPlan('Generated route draft', { flightPlan: validated, routeShapes: [], fuelSettings });
  storage.setItem(TRANSFER_KEY, JSON.stringify({ schemaVersion: 1, token, createdAt: now, plan }));
  return token;
}
/** Only the explicit token-bearing navigation consumes a staged draft; normal page visits do nothing. */
export function importGeneratedRoute(token: string | null, session: Pick<Storage, 'getItem' | 'removeItem'>,
  local: Pick<Storage, 'getItem' | 'setItem'>, store: FlightPlanStore, shapes: RouteShapeController, now = Date.now()): boolean {
  if (!token) return false;
  const raw = session.getItem(TRANSFER_KEY);
  if (!raw) throw new Error('The generated draft is no longer available. Continue planning manually. Your manual plan was kept.');
  let value: { schemaVersion?: number; token?: string; createdAt?: number; plan?: unknown };
  try { value = JSON.parse(raw); } catch { throw new Error('The generated draft could not be read. Your manual plan was kept.'); }
  if (!value || value.schemaVersion !== 1 || value.token !== token || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt) || value.createdAt > now + 5000 || now - value.createdAt > MAX_AGE_MS) throw new Error('This generated transfer is invalid or expired. Your manual plan was kept.');
  const plan = parsePlanFile(JSON.stringify(value.plan));
  if (plan.flightPlan.waypoints.length < 2) throw new Error('This generated route is incomplete. Your manual plan was kept.');
  new SavedPlanRepository(local).load(plan, store, shapes);
  session.removeItem(TRANSFER_KEY);
  return true;
}
