// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { RouteReviewPanel } from '../src/components/RouteReviewPanel';
import type { FrequencyPlanner } from '../src/frequencies/FrequencyPlanner';
import type { RadioCatalog } from '../src/frequencies/catalog';
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
  const { element, store, leg } = setup();
  expect(fetcher).not.toHaveBeenCalled();
  expect(element.querySelector('[data-aip-route]')).toBeNull();
  element.querySelector<HTMLButtonElement>('[data-route-review]')!.click();
  await vi.waitFor(() => expect(element.textContent).toContain('terrain points returned'));
  expect(element.textContent).toContain('Highest sampled surface: 328 ft');
  expect(element.textContent).toContain('Imported terminal airspace');
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
  expect(element.querySelector('[data-route-review]')!.textContent).toBe('Check terrain & airspace');
});
it('removes airspace results if verified source data expire or a reload fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => heightResponse(input)));
  const { element, expire } = setup();
  element.querySelector<HTMLButtonElement>('[data-route-review]')!.click();
  await vi.waitFor(() => expect(element.textContent).toContain('terrain points returned'));
  expire();
  expect(element.textContent).toContain('Airspace unavailable');
  expect(element.textContent).not.toContain('modeled altitude within published limits');
});
it('exposes leg-specific warnings, map actions and a visible summary, then clears stale overlays', async () => {
  const summaryElement = document.createElement('section'), onIssues = vi.fn(), onFocusIssue = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => heightResponse(input)));
  const { element, store, leg } = setup({ summaryElement, onIssues, onFocusIssue });
  document.body.append(summaryElement);
  expect(summaryElement.textContent).toContain('has not been checked');
  summaryElement.querySelector<HTMLButtonElement>('button')!.click();
  await vi.waitFor(() => expect(element.textContent).toContain('terrain points returned'));
  expect(summaryElement.textContent).toContain('conflicts');
  const warning = element.querySelector<HTMLElement>('.route-issue-conflict')!;
  expect(warning.textContent).toContain('Leg 1:'); expect(warning.textContent).toContain('Next action:');
  warning.querySelector<HTMLButtonElement>('[data-issue-action="map"]')!.click();
  expect(onFocusIssue).toHaveBeenCalledWith(expect.objectContaining({ legIndex: 0 }), expect.any(Array));
  const request = vi.fn(); window.addEventListener('flightplanner-open-leg-editor', request, { once: true });
  warning.querySelector<HTMLButtonElement>('[data-issue-action="edit"]')!.click();
  expect(request.mock.calls[0][0].detail).toEqual({ fromId: leg.from.id, toId: leg.to.id, focus: 'pl' });
  store.setPlannedAltitudeFt(leg.from.id, leg.to.id, 4000);
  expect(summaryElement.textContent).toContain('has not been checked');
  expect(onIssues.mock.calls.at(-1)![0]).toEqual([]);
});
