import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import type { RouteShapeController } from '../flightplan/RouteShapeController';
import { restoreWorkingRoute, saveWorkingRoute } from '../flightplan/workingRoutePersistence';
import { FUEL_SETTINGS_CHANGED_EVENT } from '../fuel/fuelPlanning';
import { escapeHtml } from '../utils/html';

/** Keeps damaged data until a recovery copy exists, and reports every save result. */
export class WorkingRouteStatus {
  private recoveryRaw: string | null = null;
  private recoveryCopied = false;
  private fuelSaveFailed = false;
  private recoveryMessage = '';
  private readonly recoveryKey = `flightplanner-working-route-recovery-${Date.now()}-${crypto.randomUUID()}`;

  constructor(private readonly root: HTMLElement, private readonly store: FlightPlanStore, private readonly shapes: RouteShapeController) {
    window.addEventListener(FUEL_SETTINGS_CHANGED_EVENT, event => {
      const saved = (event as CustomEvent<{ savedLocally?: boolean }>).detail?.savedLocally;
      if (typeof saved !== 'boolean') return;
      this.fuelSaveFailed = !saved;
      this.save();
    });
    root.addEventListener('click', event => {
      if (!(event.target as HTMLElement).closest('[data-download-recovery]') || this.recoveryRaw === null) return;
      const url = URL.createObjectURL(new Blob([this.recoveryRaw], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'flightplanner-route-recovery.json'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  restore(): boolean {
    const restored = restoreWorkingRoute(this.store, this.shapes, (message, raw) => {
      this.recoveryRaw = raw; this.recoveryMessage = message;
    });
    if (!this.recoveryMessage) {
      try {
        const key = Object.keys(window.localStorage).filter(key => key.startsWith('flightplanner-working-route-recovery-')).sort().at(-1);
        if (key) {
          this.recoveryRaw = window.localStorage.getItem(key);
          this.recoveryCopied = true;
          this.recoveryMessage = 'A retained working-route recovery copy is available for download.';
        }
      } catch { /* Recovery listing is optional; save failures are reported below. */ }
    }
    this.show(restored ? 'Working route restored locally.' : this.recoveryMessage ? '' : 'Autosave ready.');
    return restored;
  }

  save(): boolean {
    if (this.recoveryRaw !== null && !this.recoveryCopied) {
      try {
        // Never replace the damaged original unless this exact copy was saved.
        window.localStorage.setItem(this.recoveryKey, this.recoveryRaw);
        this.recoveryCopied = true;
      } catch {
        this.show('Autosave paused: recovery data could not be copied. Download the recovery data and export your current plan under Save & load before closing.');
        return false;
      }
    }
    const saved = saveWorkingRoute(this.store, this.shapes);
    this.show(saved ? 'Saved locally.' : 'Autosave failed. Export your current plan under Save & load before closing.');
    return saved;
  }

  private show(message: string): void {
    if (this.fuelSaveFailed) message = `${message === 'Saved locally.' ? 'Route saved locally.' : message} Fuel settings are unsaved locally. Export your current plan under Save & load before closing.`;
    const markup = `<span>${escapeHtml(message)}</span>${this.recoveryMessage ? `<span class="working-route-recovery">${escapeHtml(this.recoveryMessage)}${this.recoveryRaw !== null ? ' <button type="button" class="ghost-button" data-download-recovery>Download recovery data</button>' : ''}</span>` : ''}`;
    if (this.root.innerHTML !== markup) this.root.innerHTML = markup;
  }
}
