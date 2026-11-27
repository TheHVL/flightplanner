// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { AirportActivityPrompt } from '../src/components/AirportActivityPrompt';
import { FlightPlanStore, parseWorkingDraftState } from '../src/flightplan/FlightPlanStore';

let store: FlightPlanStore, prompt: AirportActivityPrompt, dialog: HTMLDialogElement;
const airport = (name = 'ENDU', elevationFt = 254) => {
  store.appendAipWaypoints([{ name, lat: 69, lon: 18, aipId: name, aipEffectiveDate: '2026-09-03', elevationFt }]);
  return store.getWaypoints().at(-1)!;
};
const click = (action: string) => dialog.querySelector<HTMLButtonElement>(`[data-airport-activity="${action}"]`)!.click();
beforeEach(() => {
  document.body.replaceChildren(); localStorage.clear();
  store = new FlightPlanStore(2500); prompt = new AirportActivityPrompt(store);
  dialog = document.querySelector('dialog')!;
});

it('only offers explicit airport placements, not reporting points, restores or ordinary store updates', () => {
  const a = airport();
  expect(dialog.open).toBe(false);
  store.addWaypoint({ lat: 69.2, lon: 18.2 }, 'Free point');
  prompt.offer(store.getWaypoints().at(-1)!.id);
  store.appendAipWaypoints([{ name: 'NORA', lat: 69.1, lon: 18.6, aipId: 'ENDU:NORA', aipEffectiveDate: '2026-09-03' }]);
  prompt.offer(store.getWaypoints().at(-1)!.id);
  store.restoreWorkingDraftState(store.exportWorkingDraftState());
  expect(dialog.open).toBe(false);
  prompt.offer(a.id);
  expect(dialog.open).toBe(true);
  expect(dialog.textContent).toContain('departure');
  expect(dialog.querySelector('[data-airport-activity="land"]')).toBeNull();
  click('depart');
  expect(dialog.open).toBe(false);
});

for (const action of ['land', 'touch-and-go'] as const) it(`saves ${action} with airport elevation and restores it through Undo and saved-plan parsing`, () => {
  airport(); const b = airport('ENTC', 32);
  const before = store.exportWorkingDraftState();
  prompt.offer(b.id); click(action);
  expect(dialog.open).toBe(false);
  expect(store.getWaypointVerticalConstraint(b.id)).toMatchObject({ mode: 'airport', airportActivity: action, elevationFt: 32 });
  const saved = JSON.parse(JSON.stringify(store.exportWorkingDraftState()));
  const parsed = parseWorkingDraftState(saved)!;
  const restored = new FlightPlanStore(); restored.restoreWorkingDraftState(parsed);
  expect(restored.getWaypointVerticalConstraint(b.id).airportActivity).toBe(action);
  store.undoLastAction();
  expect(store.exportWorkingDraftState()).toEqual(before);
  expect(dialog.open).toBe(false);
  store.redoLastAction();
  expect(store.getWaypointVerticalConstraint(b.id).airportActivity).toBe(action);
  expect(dialog.open).toBe(false);
  const bad = structuredClone(saved); bad.verticalWaypointConstraints[0][1].airportActivity = 'invalid';
  expect(parseWorkingDraftState(bad)).toBeNull();
});

it('validates pattern count/duration and adds the requested allowance without losing field elevation', () => {
  airport(); const b = airport('ENTC', 32);
  prompt.offer(b.id); click('patterns');
  const form = dialog.querySelector<HTMLFormElement>('form')!;
  const count = form.elements.namedItem('count') as HTMLInputElement;
  const minutes = form.elements.namedItem('minutes') as HTMLInputElement;
  const submit = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(form.hidden).toBe(false);
  count.value = '21'; submit();
  expect(dialog.open).toBe(true); expect(store.getWaypointActivityMinutes(b.id)).toBe(0);
  count.value = '2'; minutes.value = '7.5'; submit();
  expect(dialog.open).toBe(false);
  expect(store.getWaypointVerticalConstraint(b.id)).toMatchObject({ mode: 'circuits', circuitCount: 2, minutesPerCircuit: 7.5, elevationFt: 32 });
  expect(store.getWaypointActivityMinutes(b.id)).toBe(15);
});

it('allows patterns before the first departure and keeps activity when another waypoint is appended', () => {
  const a = airport(); prompt.offer(a.id); click('patterns');
  dialog.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(store.getWaypointActivityMinutes(a.id)).toBe(6);
  airport('ENTC', 32);
  expect(store.getWaypointActivityMinutes(a.id)).toBe(6);
  expect(dialog.open).toBe(false);
  const back = airport(); prompt.offer(back.id);
  expect(dialog.textContent).toContain('airport activity');
  click('land');
  expect(store.getWaypointActivityMinutes(a.id)).toBe(6);
  expect(store.getWaypointVerticalConstraint(back.id).airportActivity).toBe('land');
});

it('dismisses or escapes without changing the added waypoint', () => {
  airport(); const b = airport('ENTC', 32); const before = store.exportWorkingDraftState();
  prompt.offer(b.id); click('later');
  expect(store.exportWorkingDraftState()).toEqual(before);
  prompt.offer(b.id); dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  expect(dialog.open).toBe(false);
  expect(store.exportWorkingDraftState()).toEqual(before);
});

it('drops stale offers after removal, movement or plan loading and never reopens on Undo', () => {
  airport(); const b = airport('ENTC', 32);
  prompt.offer(b.id); store.removeWaypoint(b.id);
  expect(dialog.open).toBe(false);
  store.undoLastAction(); expect(dialog.open).toBe(false);
  prompt.offer(b.id); store.updateWaypoint(b.id, { lat: 70 });
  expect(dialog.open).toBe(false);
  store.undoLastAction(); prompt.offer(b.id); prompt.cancel();
  expect(dialog.open).toBe(false);
});
