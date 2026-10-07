// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { RouteReviewPanel } from '../src/components/RouteReviewPanel';
import type { FrequencyPlanner } from '../src/frequencies/FrequencyPlanner';
import type { RadioCatalog } from '../src/frequencies/catalog';
import { LEG_SELECTED } from '../src/components/legEditorEvents';
import { SequentialLegPanel } from '../src/components/SequentialLegPanel';
import { DEFAULT_FUEL_PLANNING_SETTINGS, saveFuelPlanningSettings } from '../src/fuel/fuelPlanning';
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
function setup(options = {}) {
  const store = new FlightPlanStore();
  store.addWaypoint({ lat: 69.05, lon: 18.5 }); store.addWaypoint({ lat: 69.65, lon: 18.9 });
  const leg = store.getLegs()[0];
  store.setPlannedAltitudeFt(leg.from.id, leg.to.id, 3000);
  store.setManualMsaFt(leg.from.id, leg.to.id, 1700);
  const element = document.createElement('section'); document.body.replaceChildren(element);
  let catalog: RadioCatalog | null = JSON.parse(readFileSync('public/aip-frequencies.json', 'utf8'));
  let listener: () => void = () => {};
  const frequencies = { reload: vi.fn(async () => {}), getVerifiedCatalog: () => catalog, getStatus: () => 'Source verification unavailable.', subscribe: (callback: () => void) => { listener = callback; } } as unknown as FrequencyPlanner;
  new RouteReviewPanel(element, store, frequencies, options);
  return { element, store, leg, frequencies, expire: () => { catalog = null; listener(); } };
}
function heightResponse(input: RequestInfo | URL) {
  const points: number[][] = JSON.parse(new URL(String(input)).searchParams.get('punkter')!);
  return new Response(JSON.stringify({ koordsys: 4258, punkter: points.map(([x, y]) => ({ x, y, z: 100, terreng: 'Skog', datakilde: 'dtm1' })) }));
}
it('runs only on request, leaves MSA intact and clears results when the plan changes', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => heightResponse(input)); vi.stubGlobal('fetch', fetcher);
  const { element, store, leg, frequencies } = setup();
  expect(fetcher).not.toHaveBeenCalled();
  expect(element.querySelector('[data-aip-route]')).toBeNull();
  element.querySelector<HTMLButtonElement>('[data-route-review]')!.click();
  await vi.waitFor(() => expect(element.textContent).toContain('terrain points returned'));
  expect(element.textContent).toContain('Highest sampled surface: 328 ft');
  expect(element.textContent).not.toContain('Imported terminal airspace');
  expect(frequencies.reload).not.toHaveBeenCalled();
  expect(store.getManualMsaFt(leg.from.id, leg.to.id)).toBe(1700);
  store.setPlannedAltitudeFt(leg.from.id, leg.to.id, 4000);
  expect(element.textContent).toContain('Plan changed');
  expect(element.textContent).not.toContain('Highest sampled surface');
});
it('discards in-flight responses when a waypoint moves', async () => {
  const pending: Array<() => void> = [];
  let completed = 0;
  const fetcher = vi.fn((input: RequestInfo | URL) => new Promise<Response>(r => { pending.push(() => { completed++; r(heightResponse(input)); }); }));
  vi.stubGlobal('fetch', fetcher);
  const { element, store, leg } = setup();
  element.querySelector<HTMLButtonElement>('[data-route-review]')!.click();
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  store.updateWaypoint(leg.to.id, { lat: 69.7, lon: 18.9 });
  pending.forEach(resolve => resolve());
  await vi.waitFor(() => expect(completed).toBe(pending.length));
  expect(element.textContent).toContain('Plan changed');
  expect(element.querySelector('[data-menu-section="route-review-0"]')).toBeNull();
  expect(element.querySelector('[data-route-review]')!.textContent).toBe('Check selected leg');
});
it('removes airspace results if verified source data expire or a reload fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => heightResponse(input)));
  const { element, expire } = setup();
  toggle(element, '[data-review-airspace]', true);
  element.querySelector<HTMLButtonElement>('[data-route-review]')!.click();
  await vi.waitFor(() => expect(element.textContent).toContain('terrain points returned'));
  expire();
  expect(element.textContent).toContain('Airspace unavailable');
  expect(element.textContent).not.toContain('modeled altitude within published limits');
});
it('keeps findings collapsed and map overlays optional, with actions to focus or edit a leg', async () => {
  const onIssues = vi.fn(), onFocusIssue = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => heightResponse(input)));
  const { element, store, leg } = setup({ onIssues, onFocusIssue });
  element.querySelector<HTMLButtonElement>('[data-route-review]')!.click();
  await vi.waitFor(() => expect(element.textContent).toContain('terrain points returned'));
  expect(element.querySelector<HTMLDetailsElement>('[data-menu-section="route-review-findings"]')!.open).toBe(false);
  expect(onIssues.mock.calls.at(-1)![0]).toEqual([]);
  toggle(element, '[data-review-map]', true);
  expect(onIssues.mock.calls.at(-1)![0].length).toBeGreaterThan(0);
  toggle(element, '[data-review-map]', false);
  expect(onIssues.mock.calls.at(-1)![0]).toEqual([]);
  const warning = element.querySelector<HTMLElement>('.route-issue-conflict')!;
  expect(warning.textContent).toContain('Leg 1:'); expect(warning.textContent).toContain('Next action:');
  warning.querySelector<HTMLButtonElement>('[data-issue-action="map"]')!.click();
  expect(onFocusIssue).toHaveBeenCalledWith(expect.objectContaining({ legIndex: 0 }), expect.any(Array));
  const request = vi.fn(); window.addEventListener('flightplanner-open-leg-editor', request, { once: true });
  element.querySelector<HTMLButtonElement>('[data-issue-action="edit"]')!.click();
  expect(request.mock.calls[0][0].detail).toEqual({ fromId: leg.from.id, toId: leg.to.id, focus: 'pl' });
  store.setPlannedAltitudeFt(leg.from.id, leg.to.id, 4000);
  expect(onIssues.mock.calls.at(-1)![0]).toEqual([]);
});

function toggle(element: HTMLElement, selector: string, checked: boolean) {
  const input = element.querySelector<HTMLInputElement>(selector)!;
  input.checked = checked; input.dispatchEvent(new Event('change', { bubbles: true }));
}
function select(element: HTMLElement, scope: string) {
  const input = element.querySelector<HTMLSelectElement>('[data-review-scope]')!;
  input.value = scope; input.dispatchEvent(new Event('change', { bubbles: true }));
}
it('checks only the selected leg and can explicitly check the whole route', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => heightResponse(input)); vi.stubGlobal('fetch', fetcher);
  const { element, store, leg } = setup();
  store.addWaypoint({ lat: 70.2, lon: 19.2 });
  const second = store.getLegs()[1];
  store.setPlannedAltitudeFt(second.from.id, second.to.id, 3000);
  store.setManualMsaFt(second.from.id, second.to.id, 2100);
  window.dispatchEvent(new CustomEvent(LEG_SELECTED, { detail: { fromId: second.from.id, toId: second.to.id } }));
  element.querySelector<HTMLButtonElement>('[data-route-review]')!.click();
  await vi.waitFor(() => expect(element.textContent).toContain('terrain points returned'));
  const latitudes = fetcher.mock.calls.flatMap(([input]) => JSON.parse(new URL(String(input)).searchParams.get('punkter')!) as number[][]).map(point => point[1]);
  expect(Math.min(...latitudes)).toBeGreaterThan(69.6);
  expect(element.querySelector('[data-menu-section="route-review-0"]')).toBeNull();
  expect(element.querySelector('[data-menu-section="route-review-1"]')).not.toBeNull();
  expect(store.getManualMsaFt(leg.from.id, leg.to.id)).toBe(1700);
  expect(store.getManualMsaFt(second.from.id, second.to.id)).toBe(2100);
  fetcher.mockClear(); select(element, 'all');
  expect(fetcher).not.toHaveBeenCalled();
  expect(element.textContent).not.toContain('Highest sampled surface');
  element.querySelector<HTMLButtonElement>('[data-route-review]')!.click();
  await vi.waitFor(() => expect(element.textContent).toContain('terrain points returned'));
  expect(element.querySelector('[data-menu-section="route-review-0"]')).not.toBeNull();
  expect(element.querySelector('[data-menu-section="route-review-1"]')).not.toBeNull();
  expect(fetcher.mock.calls.flatMap(([input]) => JSON.parse(new URL(String(input)).searchParams.get('punkter')!) as number[][]).some(point => point[1] < 69.1)).toBe(true);
  element.querySelector<HTMLButtonElement>('[data-route-review-clear]')!.click();
  expect(element.textContent).toContain('Check cleared');
  expect(element.textContent).not.toContain('Highest sampled surface');
});
it('uses the full route altitude profile when checking a later leg', async () => {
  saveFuelPlanningSettings({ ...DEFAULT_FUEL_PLANNING_SETTINGS, climbPerformanceMode: 'manual' });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const points: number[][] = JSON.parse(new URL(String(input)).searchParams.get('punkter')!);
    return new Response(JSON.stringify({ koordsys: 4258, punkter: points.map(([x, y]) => ({ x, y, z: y > 70.1 ? 3500 / 3.280839895 : 100, terreng: 'Skog', datakilde: 'dtm1' })) }));
  }));
  const { element, store } = setup();
  store.addWaypoint({ lat: 70.2, lon: 19.2 });
  const second = store.getLegs()[1];
  store.setPlannedAltitudeFt(second.from.id, second.to.id, 5000);
  store.updateVerticalProfileSettings({ departureElevationFt: 3000, destinationElevationFt: 5000 });
  select(element, `${second.from.id}->${second.to.id}`);
  element.querySelector<HTMLButtonElement>('[data-route-review]')!.click();
  await vi.waitFor(() => expect(element.textContent).toContain('terrain points returned'));
  expect(element.textContent).toContain('Highest sampled surface: 3500 ft');
  expect(element.textContent).toContain('Smallest sampled altitude margin: 1500 ft');
});
it('reveals the optional check from the leg editor and saves its pending altitude first', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => heightResponse(input)); vi.stubGlobal('fetch', fetcher);
  const { element, store, leg } = setup();
  const disclosure = document.createElement('details'); element.replaceWith(disclosure); disclosure.append(element);
  const editor = document.createElement('section'); document.body.append(editor);
  new SequentialLegPanel(editor, store);
  const pl = editor.querySelector<HTMLInputElement>('[data-leg-field="pl"]')!;
  pl.value = '4200'; pl.dispatchEvent(new Event('input', { bubbles: true }));
  editor.querySelector<HTMLButtonElement>('[data-leg-terrain]')!.click();
  expect(store.getPlannedAltitudeFt(leg.from.id, leg.to.id)).toBe(4200);
  expect(disclosure.open).toBe(true);
  await vi.waitFor(() => expect(element.textContent).toContain('terrain points returned'));
});
it('discards responses when the selected leg changes while a check is pending', async () => {
  const pending: Array<() => void> = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => new Promise<Response>(resolve => pending.push(() => resolve(heightResponse(input))))));
  const { element, store } = setup(); store.addWaypoint({ lat: 70.2, lon: 19.2 });
  element.querySelector<HTMLButtonElement>('[data-route-review]')!.click();
  await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
  const second = store.getLegs()[1];
  window.dispatchEvent(new CustomEvent(LEG_SELECTED, { detail: { fromId: second.from.id, toId: second.to.id } }));
  pending.forEach(resolve => resolve());
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(element.textContent).toContain('Selection changed');
  expect(element.textContent).not.toContain('Highest sampled surface');
  expect(element.querySelector('[data-route-review]')!.textContent).toBe('Check selected leg');
});
