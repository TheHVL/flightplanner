// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { publishedMapPoints } from '../src/aip/mapPoints';
import { expect, it, vi } from 'vitest';
import type { MapManagerCallbacks } from '../src/map/MapManager';
import type { RouteLeg } from '../src/types';

const map = vi.hoisted(() => ({ callbacks: null as MapManagerCallbacks | null, legs: [] as RouteLeg[] }));
vi.mock('../src/map/MapManager', () => ({ MapManager: class {
  constructor(_element: HTMLElement, callbacks: MapManagerCallbacks) { map.callbacks = callbacks; }
  invalidateSize() {} setChartDetail() {} setMsaCorridorVisible() {} setGlideEnvelopeVisible() {}
  renderMsaCorridor() {} renderVerticalProfileConflicts() {} renderVerticalProfileMarkers() {}
  renderGlideEnvelope() {} renderGlideCoastlineSegments() {} setSelectedLeg() {}
  setPublishedPoints() {} setSnapEnabled() {}
  renderRoute(_points: unknown, legs: RouteLeg[]) { map.legs = legs; }
} }));

it('mounts the complete workflow and connects map requests to the shared editor', async () => {
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const name = String(input).includes('aip-frequencies.json') ? 'aip-frequencies.json'
      : String(input).includes('aip-frequency-status.json') ? 'aip-frequency-status.json'
      : String(input).includes('aip-status.json') ? 'aip-status.json' : 'aip-aerodromes.json';
    return new Response(readFileSync(`public/${name}`, 'utf8'), { status: 200 });
  }));
  await import('../src/main');
  const titles = [...document.querySelectorAll('.workflow-step > summary strong')].map(e => e.textContent);
  expect(titles).toEqual(['Build route', 'Prepare legs', 'Weather & fuel', 'Review OFP']);
  expect(document.querySelector('#aircraft-settings-panel')!.closest('[data-panel-key="settings"]')).not.toBeNull();
  expect(document.querySelector('#profile-settings-panel')!.querySelector('[data-aip-endpoint-code]')).toBeNull();
  expect(document.querySelector('#performance-panel')!.querySelector('[data-performance-field]')).toBeNull();
  map.callbacks!.onMapClick(69, 18);
  map.callbacks!.onMapClick(69.2, 18.5);
  map.callbacks!.onMapClick(69.5, 19);
  map.callbacks!.onLegSelected!(1);
  expect(document.querySelector<HTMLSelectElement>('[data-leg-selector]')!.value).toBe('1');
  const pl = document.querySelector<HTMLInputElement>('[data-leg-field="pl"]')!;
  pl.value = '3000'; pl.dispatchEvent(new Event('change', { bubbles: true }));
  expect(document.querySelector('[data-workflow-summary="leg-entry"]')!.textContent).toContain('1 missing PL');
  const second = map.legs[1];
  map.callbacks!.onWaypointSelected!(second.to.id);
  expect(document.querySelector<HTMLDetailsElement>('[data-leg-visit]')!.open).toBe(true);
  expect(document.querySelector('[data-aip-endpoint-code="destination"]')).not.toBeNull();
  expect(document.querySelector('[data-frequency-leg]')).toBeNull();
  expect(document.querySelector('#weather-panel')!.querySelector('[data-manual-wind-field]')).toBeNull();
  const points = publishedMapPoints(JSON.parse(readFileSync('public/aip-aerodromes.json', 'utf8')));
  const airport = points.find(p => p.aipId === 'ENTC')!;
  const reporting = points.find(p => p.aipId === 'ENDU:ROSSVOLL')!;
  expect(document.querySelector<HTMLInputElement>('#aip-snap-toggle')!.checked).toBe(true);
  map.callbacks!.onWaypointMoved(second.to.id, airport.lat, airport.lon, airport);
  map.callbacks!.onWaypointSelected!(second.to.id);
  expect(document.querySelector('[aria-label="Arrival pattern"]')).not.toBeNull();
  map.callbacks!.onWaypointMoved(second.to.id, reporting.lat, reporting.lon, reporting);
  map.callbacks!.onWaypointSelected!(second.to.id);
  expect(document.querySelector('[aria-label="Arrival pattern"]')).toBeNull();
  expect(document.querySelector('[data-leg-visit-title]')!.textContent).toBe('Waypoint · ROSSVOLL');
  map.callbacks!.onMapClick(airport.lat, airport.lon, airport);
  map.callbacks!.onMapClick(airport.lat, airport.lon, airport);
  expect(document.querySelector('[data-workflow-summary="route"]')!.textContent).toContain('4 waypoints');
  vi.unstubAllGlobals();
});
