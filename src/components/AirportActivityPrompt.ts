import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { escapeHtml } from '../utils/html';

/** Offered by explicit placement actions, never by restoring/undoing a plan. */
export class AirportActivityPrompt {
  private readonly dialog = document.createElement('dialog');
  private queue: string[] = [];
  private active: { id: string; identity: string } | null = null;

  constructor(private readonly store: FlightPlanStore) {
    this.dialog.className = 'airport-activity-dialog';
    this.dialog.setAttribute('aria-labelledby', 'airport-activity-title');
    this.dialog.setAttribute('aria-describedby', 'airport-activity-description');
    document.body.append(this.dialog);
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.dismiss(); });
    this.dialog.addEventListener('click', event => {
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-airport-activity]')?.dataset.airportActivity;
      if (!action || !this.active) return;
      if (action === 'later') { this.dismiss(); return; }
      if (action === 'patterns') {
        this.dialog.querySelector<HTMLElement>('[data-airport-pattern-form]')!.hidden = false;
        this.dialog.querySelector<HTMLInputElement>('[name="count"]')!.focus();
        return;
      }
      this.store.setWaypointVerticalConstraint(this.active.id, {
        mode: 'airport',
        ...(action === 'land' ? { airportActivity: 'land' as const } : action === 'touch-and-go' ? { airportActivity: 'touch-and-go' as const } : {}),
      });
      this.dismiss();
    });
    this.dialog.addEventListener('submit', event => {
      event.preventDefault();
      const form = event.target as HTMLFormElement;
      if (!this.active || !form.reportValidity()) return;
      this.store.setWaypointVerticalConstraint(this.active.id, { mode: 'circuits',
        circuitCount: Number((form.elements.namedItem('count') as HTMLInputElement).value),
        minutesPerCircuit: Number((form.elements.namedItem('minutes') as HTMLInputElement).value),
      });
      this.dismiss();
    });
    store.subscribe(() => {
      if (this.active && this.identity(this.active.id) !== this.active.identity) this.dismiss();
    });
  }

  offer(id: string): void {
    if (!this.identity(id) || this.active?.id === id || this.queue.includes(id)) return;
    this.queue.push(id);
    this.showNext();
  }

  /** Called before loading another plan, including one reusing the same IDs. */
  cancel(): void { this.queue = []; this.dismiss(); }

  private identity(id: string): string | null {
    const points = this.store.getWaypoints(), point = points.find(item => item.id === id);
    return point && this.store.isAirportWaypoint(id)
      ? JSON.stringify([id, point.aipId, point.lat, point.lon, points[0].id === id]) : null;
  }

  private dismiss(): void {
    if (this.dialog.open) this.dialog.close();
    this.active = null;
    this.showNext();
  }

  private showNext(): void {
    if (this.active) return;
    let id: string | undefined, identity: string | null = null;
    while ((id = this.queue.shift()) !== undefined) { identity = this.identity(id); if (identity) break; }
    if (!id || !identity) return;
    const points = this.store.getWaypoints(), point = points.find(item => item.id === id)!;
    const departure = points[0].id === id;
    const constraint = this.store.getWaypointVerticalConstraint(id);
    this.active = { id, identity };
    this.dialog.innerHTML = `
      <h2 id="airport-activity-title">${escapeHtml(point.name)} · ${departure ? 'departure' : 'airport activity'}</h2>
      <p id="airport-activity-description">${departure ? 'Depart from here, or plan patterns before leaving.' : 'What will you do at this airport?'}</p>
      <div class="airport-activity-choices">
        ${departure ? '<button type="button" data-airport-activity="depart" autofocus>Depart</button>' : '<button type="button" data-airport-activity="land" autofocus>Land</button><button type="button" data-airport-activity="touch-and-go">Touch-and-go</button>'}
        <button type="button" data-airport-activity="patterns">Patterns</button>
      </div>
      <form data-airport-pattern-form ${constraint.mode === 'circuits' ? '' : 'hidden'}>
        <div class="airport-pattern-inputs">
          <label>Patterns<input name="count" type="number" min="1" max="20" step="1" value="${constraint.circuitCount}" required></label>
          <label>Minutes per pattern<input name="minutes" type="number" min="1" max="30" step="0.5" value="${constraint.minutesPerCircuit}" required></label>
        </div>
        <p>Pattern time and fuel are added ${departure ? 'before departure' : 'after arrival'}.</p>
        <button type="submit" class="airport-activity-primary">Apply patterns</button>
      </form>
      ${departure ? '' : '<p class="airport-activity-note">Land and touch-and-go use field elevation; ground time is not added. Add your next waypoint to plan departure after a touch-and-go.</p>'}
      <button type="button" class="airport-activity-later" data-airport-activity="later">Not now</button>`;
    this.dialog.showModal();
  }
}
