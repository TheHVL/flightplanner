// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { SequentialLegPanel } from '../src/components/SequentialLegPanel';
import { FrequencyPanel } from '../src/components/FrequencyPanel';
import { FrequencyPlanner } from '../src/frequencies/FrequencyPlanner';
import { VerticalProfilePanel } from '../src/components/VerticalProfilePanel';
import { PlanningWorkflow, planningSidebarMarkup } from '../src/components/PlanningWorkflow';
import { OFPTable } from '../src/components/OFPTable';
import { RoutePanel } from '../src/components/RoutePanel';
import { openLegEditor } from '../src/components/legEditorEvents';
import { identifyTestAirport } from './helpers/airports';

let store: FlightPlanStore, root: HTMLElement, editor: SequentialLegPanel, ofp: HTMLElement;
const change = (node: HTMLInputElement | HTMLSelectElement, value: string) => {
  node.value = value;
  node.dispatchEvent(new Event('change', { bubbles: true }));
};
beforeEach(() => {
  localStorage.clear();
  store = new FlightPlanStore();
  store.addWaypoint({ lat: 69, lon: 18 }, 'ENDU');
  store.addWaypoint({ lat: 69.2, lon: 18.5 }, 'NORA');
  store.addWaypoint({ lat: 69.5, lon: 19 }, 'ENDU');
  store.getWaypoints().filter(p => p.name === 'ENDU').forEach(p => identifyTestAirport(store, p.id));
  root = document.createElement('aside'); root.innerHTML = planningSidebarMarkup;
  ofp = document.createElement('section'); document.body.replaceChildren(root, ofp);
  const element = root.querySelector<HTMLElement>('#sequential-leg-panel')!;
  editor = new SequentialLegPanel(element, store);
  const frequency = new FrequencyPanel(element.querySelector('[data-leg-frequency]')!, store, new FrequencyPlanner(store), true);
  new VerticalProfilePanel(element.querySelector('[data-waypoint-visit]')!, store, 'waypoint');
  editor.onSelection((from, to) => frequency.selectLeg(from, to));
  new PlanningWorkflow(root, store);
  const table = new OFPTable(ofp, store);
  store.subscribe(() => table.render()); table.render();
  const route = new RoutePanel(root.querySelector('#route-panel')!, store);
  store.subscribe(() => route.render()); route.render();
});
afterEach(() => document.body.replaceChildren());

describe('one shared leg editor', () => {
  it('opens the OFP-selected leg and saves levels and a custom channel to that leg only', () => {
    const second = store.getLegs()[1];
    ofp.querySelectorAll<HTMLButtonElement>('[data-editor-field="pl"]')[1].click();
    expect(editor.getSelectedLeg()).toEqual({ fromId: second.from.id, toId: second.to.id });
    expect(root.querySelector<HTMLDetailsElement>('[data-panel-key="leg-entry"]')!.open).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('[data-leg-field="pl"]'));
    change(root.querySelector('[data-leg-field="pl"]')!, '3000');
    change(root.querySelector('[data-leg-field="msa"]')!, '2000');
    change(root.querySelector('[data-frequency-manual]')!, '126.455');
    expect(store.getPlannedAltitudeFt(second.from.id, second.to.id)).toBe(3000);
    expect(store.getManualMsaFt(second.from.id, second.to.id)).toBe(2000);
    expect(store.getManualFrequency(second.from.id, second.to.id)).toBe('126.455');
    const first = store.getLegs()[0];
    expect(store.getManualFrequency(first.from.id, first.to.id)).toBeNull();
    expect(root.querySelector('[data-frequency-leg]')).toBeNull();
    expect(ofp.querySelector('input')).toBeNull();
    expect(ofp.querySelectorAll('.ofp-frequency-cell')[1].textContent).toBe('126.455Edit');
    expect(root.querySelector('[data-workflow-summary="leg-entry"]')!.textContent).toContain('1 missing PL');
  });

  it('saves the current draft before changing legs and refuses to discard incomplete wind', () => {
    const first = store.getLegs()[0], second = store.getLegs()[1];
    const pl = root.querySelector<HTMLInputElement>('[data-leg-field="pl"]')!;
    pl.value = '2500'; // A typed draft that has not blurred yet.
    openLegEditor({ fromId: second.from.id, toId: second.to.id });
    expect(store.getPlannedAltitudeFt(first.from.id, first.to.id)).toBe(2500);
    expect(pl.value).toBe('');
    root.querySelector<HTMLInputElement>('[data-leg-field="direction"]')!.value = '240';
    openLegEditor({ fromId: first.from.id, toId: first.to.id });
    expect(editor.getSelectedLeg().fromId).toBe(second.from.id);
    expect(root.querySelector('[data-leg-status]')!.textContent).toContain('both');
    expect(root.querySelector<HTMLInputElement>('[data-leg-field="direction"]')!.value).toBe('240');
  });

  it('preserves partial wind drafts while frequency and forecast panels refresh', () => {
    const first = store.getLegs()[0];
    const direction = root.querySelector<HTMLInputElement>('[data-leg-field="direction"]')!;
    direction.value = '240'; direction.dispatchEvent(new Event('input', { bubbles: true }));
    direction.dispatchEvent(new Event('change', { bubbles: true }));
    store.setManualFrequency(first.from.id, first.to.id, '126.455');
    expect(direction.value).toBe('240');
    expect(root.querySelector<HTMLInputElement>('[data-leg-field="speed"]')!.value).toBe('');
    change(root.querySelector('[data-leg-field="speed"]')!, '15');
    expect(store.getManualLegWind(first.from.id, first.to.id)).toEqual({ windFromDeg: 240, windSpeedKt: 15 });
  });

  it('shows airport/pattern controls for the exact waypoint, even when airport names repeat', () => {
    const points = store.getWaypoints();
    root.querySelectorAll<HTMLButtonElement>('[data-action="visit"]')[2].click();
    expect(root.querySelector('[data-leg-visit-title]')!.textContent).toContain('ENDU');
    change(root.querySelector('[aria-label="Arrival pattern"]')!, 'circuits');
    change(root.querySelector('[data-vertical-circuit-count]')!, '2');
    change(root.querySelector('[data-vertical-circuit-minutes]')!, '5');
    expect(store.getWaypointActivityMinutes(points[2].id)).toBe(10);
    expect(store.getWaypointActivityMinutes(points[0].id)).toBe(0);
    expect(ofp.querySelector('[data-pattern-waypoint]')!.getAttribute('data-pattern-waypoint')).toBe(points[2].id);
    root.querySelectorAll<HTMLButtonElement>('[data-action="visit"]')[0].click();
    expect(root.querySelector('[data-aip-endpoint-code]')!.getAttribute('data-aip-endpoint-code')).toBe('departure');
    expect(root.querySelector('[data-leg-visit-title]')!.textContent).toContain('ENDU');
  });

  it('replaces pending drafts with loaded plan values when waypoint IDs stay the same', () => {
    const leg = store.getLegs()[0];
    change(root.querySelector('[data-leg-field="pl"]')!, '2500');
    const direction = root.querySelector<HTMLInputElement>('[data-leg-field="direction"]')!;
    direction.value = '240'; direction.dispatchEvent(new Event('input', { bubbles: true }));
    store.setPlannedAltitudeFt(leg.from.id, leg.to.id, 4000);
    editor.onPlanLoaded();
    expect(root.querySelector<HTMLInputElement>('[data-leg-field="pl"]')!.value).toBe('4000');
    expect(direction.value).toBe('');
  });

  it('reselects after route deletion and exposes live summaries without changing plan data', () => {
    const second = store.getLegs()[1];
    openLegEditor({ fromId: second.from.id, toId: second.to.id });
    store.removeWaypoint(second.from.id);
    expect(editor.getSelectedLeg().fromId).toBe(store.getWaypoints()[0].id);
    const snapshot = store.exportWorkingDraftState();
    new PlanningWorkflow(root, store).render();
    expect(store.exportWorkingDraftState()).toEqual(snapshot);
    expect(root.querySelector('[data-workflow-summary="route"]')!.textContent).toContain('2 waypoints');
    store.clear();
    expect(root.querySelector<HTMLInputElement>('[data-leg-field="pl"]')!.disabled).toBe(true);
    expect(root.querySelector('[data-workflow-summary="route"]')!.textContent).toContain('departure');
    expect(root.querySelector('[data-leg-frequency]')!.textContent).toContain('two waypoints');
  });
});
