import type { BaseMapId, MapManager } from '../map/MapManager';

export class MapLayerPanel {
  constructor(
    private readonly element: HTMLElement,
    private readonly mapManager: MapManager,
  ) {
    this.element.addEventListener('change', (event) => this.handleChange(event));
  }

  render(): void {
    const state = this.mapManager.getLayerState();
    this.element.innerHTML = `
      <div class="map-source-buttons" role="group" aria-label="Map source">
        <label class="source-option ${state.baseMap === 'norgeskart' && !state.overlayMode ? 'active' : ''}">
          <input type="radio" name="basemap" value="norgeskart" ${state.baseMap === 'norgeskart' && !state.overlayMode ? 'checked' : ''} />
          <span>Norgeskart</span>
        </label>
        <label class="source-option ${state.baseMap === 'icao500' && !state.overlayMode ? 'active' : ''} ${!state.icaoAvailable ? 'disabled' : ''}">
          <input type="radio" name="basemap" value="icao500" ${state.baseMap === 'icao500' && !state.overlayMode ? 'checked' : ''} ${!state.icaoAvailable ? 'disabled' : ''} />
          <span>ICAO 1:500 000</span>
        </label>
      </div>
      <label class="overlay-toggle ${!state.icaoAvailable ? 'disabled' : ''}">
        <input type="checkbox" data-map-setting="overlay" ${state.overlayMode ? 'checked' : ''} ${!state.icaoAvailable ? 'disabled' : ''} />
        <span>ICAO overlay</span>
      </label>
      <label class="opacity-control ${!state.icaoAvailable ? 'disabled' : ''}">
        <span>Opacity</span>
        <input type="range" data-map-setting="opacity" min="0" max="100" step="5" value="${Math.round(state.icaoOpacity * 100)}" ${!state.icaoAvailable ? 'disabled' : ''} />
        <b>${Math.round(state.icaoOpacity * 100)}%</b>
      </label>
      ${!state.icaoAvailable ? '<div class="layer-license-note">ICAO layer is disabled until an authorized Avinor export service is configured.</div>' : ''}
    `;
  }

  private handleChange(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (input.name === 'basemap') {
      this.mapManager.setBaseMap(input.value as BaseMapId);
    } else if (input.dataset.mapSetting === 'overlay') {
      this.mapManager.setIcaoOverlay(input.checked);
    } else if (input.dataset.mapSetting === 'opacity') {
      this.mapManager.setIcaoOpacity(Number(input.value) / 100);
    }

    this.render();
  }
}
