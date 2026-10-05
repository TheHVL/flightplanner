// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { SequentialLegPanel } from '../src/components/SequentialLegPanel';

let store: FlightPlanStore;
let element: HTMLElement;
const fields = () => Array.from(element.querySelectorAll<HTMLInputElement>('[data-leg-field]'));
const enter = (field: HTMLInputElement, value: string, shiftKey = false) => {
  field.focus(); field.value = value;
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true }));
};
beforeEach(() => {
  store = new FlightPlanStore();
  store.addWaypoint({lat:69,lon:18}, 'A');
  store.addWaypoint({lat:69.1,lon:18.1}, 'B');
  store.addWaypoint({lat:69.2,lon:18.2}, 'C');
  element = document.createElement('section');
  document.body.replaceChildren(element);
  new SequentialLegPanel(element, store);
});
describe('sequential leg preparation', () => {
  it('saves a row through Enter, including a partial direction, then advances and keeps focus', () => {
    const inputs = fields();
    enter(inputs[0], '3500'); expect(document.activeElement).toBe(inputs[1]);
    enter(inputs[1], '3000'); expect(document.activeElement).toBe(inputs[2]);
    enter(inputs[2], '360'); expect(document.activeElement).toBe(inputs[3]);
    expect(inputs[2].value).toBe('360');
    enter(inputs[3], '20'); expect(document.activeElement).toBe(inputs[0]);
    expect(element.querySelector('select')!.value).toBe('1');
    const first = store.getLegs()[0];
    expect(store.getPlannedAltitudeFt(first.from.id,first.to.id)).toBe(3500);
    expect(store.getManualMsaFt(first.from.id,first.to.id)).toBe(3000);
    expect(store.getManualLegWind(first.from.id,first.to.id)).toEqual({windFromDeg:0,windSpeedKt:20});
  });
  it('does not advance a row with incomplete or out-of-range wind', () => {
    fields()[2].value = '180';
    enter(fields()[3], '');
    expect(element.querySelector('select')!.value).toBe('0');
    expect(element.querySelector('[data-leg-status]')!.textContent).toContain('both');
    enter(fields()[3], '151');
    expect(element.querySelector('select')!.value).toBe('0');
  });
  it('keeps a partially entered wind on change/blur events and supports backwards traversal', () => {
    fields()[2].value = '240';
    document.body.focus();
    fields()[2].dispatchEvent(new Event('change', { bubbles: true }));
    expect(fields()[2].value).toBe('240');
    enter(fields()[3], '15');
    enter(fields()[0], '4500', true);
    expect(element.querySelector('select')!.value).toBe('0');
    expect(document.activeElement).toBe(fields()[3]);
  });
  it('reselects a valid leg after deletion without writing settings to a removed leg', () => {
    store.removeWaypoint(store.getWaypoints()[1].id);
    enter(fields()[0], '2500');
    const leg=store.getLegs()[0];
    expect(store.getPlannedAltitudeFt(leg.from.id,leg.to.id)).toBe(2500);
    store.clear();
    expect(fields()[0].disabled).toBe(true);
  });
});
