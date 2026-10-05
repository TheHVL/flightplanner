import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { ROUTE_SHAPE_CHANGED_EVENT, type RouteShapeController } from '../flightplan/RouteShapeController';
import { FUEL_SETTINGS_CHANGED_EVENT } from '../fuel/fuelPlanning';
import { capturePlan, createPlan, MAX_PLAN_FILE_BYTES, SavedPlanRepository, type SavedPlan } from '../flightplan/savedPlans';

export class PlanLibraryPanel {
  private readonly name: HTMLInputElement;
  private readonly selection: HTMLSelectElement;
  private readonly file: HTMLInputElement;
  private readonly message: HTMLElement;
  private readonly state: HTMLElement;
  private plans: SavedPlan[] = [];
  private repository: SavedPlanRepository | null = null;
  private busy = false;

  constructor(private readonly element: HTMLElement, private readonly store: FlightPlanStore,
    private readonly shapes: RouteShapeController, private readonly onLoaded: () => void) {
    this.element.innerHTML = `
      <div class="saved-plans-fields">
        <label for="plan-name">Plan name</label>
        <input id="plan-name" type="text" maxlength="100" placeholder="e.g. ENDU - ENTC training" autocomplete="off" />
        <div class="saved-plans-actions">
          <button class="ghost-button" type="button" data-plan-action="save">Save as new</button>
          <button class="ghost-button" type="button" data-plan-action="update">Update selected</button>
        </div>
        <label for="saved-plan-select">Saved plans</label>
        <select id="saved-plan-select" aria-describedby="saved-plan-state"></select>
        <p id="saved-plan-state" class="saved-plans-state"></p>
        <div class="saved-plans-actions">
          <button class="ghost-button" type="button" data-plan-action="load">Load selected</button>
          <button class="ghost-button" type="button" data-plan-action="duplicate">Duplicate selected</button>
          <button class="ghost-button" type="button" data-plan-action="delete">Delete selected</button>
          <button class="ghost-button" type="button" data-plan-action="previous">Restore previous work</button>
        </div>
        <div class="saved-plans-actions saved-plans-files">
          <button class="ghost-button" type="button" data-plan-action="export">Export current plan</button>
          <button class="ghost-button" type="button" data-plan-action="import">Import plan file</button>
          <input id="plan-import-file" type="file" accept=".json,application/json" hidden />
        </div>
        <p class="saved-plans-note">Saved in this browser. Export a JSON file for backup or another device. Changes to your working plan are saved separately; use Update selected to replace a named plan.</p>
        <p class="saved-plans-message" role="status" aria-live="polite"></p>
      </div>`;
    this.name = this.element.querySelector<HTMLInputElement>('#plan-name')!;
    this.selection = this.element.querySelector<HTMLSelectElement>('#saved-plan-select')!;
    this.file = this.element.querySelector<HTMLInputElement>('#plan-import-file')!;
    this.message = this.element.querySelector<HTMLElement>('.saved-plans-message')!;
    this.state = this.element.querySelector<HTMLElement>('#saved-plan-state')!;
    try { this.repository = new SavedPlanRepository(window.localStorage); this.refreshList(); }
    catch (error) { this.report(error); }
    this.selection.addEventListener('change', () => {
      this.name.value = this.selected()?.name ?? '';
      this.refreshState();
    });
    this.name.addEventListener('input', () => this.refreshState());
    this.name.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); this.act('save'); }
    });
    this.element.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-plan-action]')?.dataset.planAction;
      if (action) this.act(action);
    });
    this.file.addEventListener('change', () => { void this.importFile(); });
    this.store.subscribe(() => this.refreshState());
    window.addEventListener(ROUTE_SHAPE_CHANGED_EVENT, () => this.refreshState());
    window.addEventListener(FUEL_SETTINGS_CHANGED_EVENT, () => this.refreshState());
    window.addEventListener('storage', () => {
      try { this.refreshList(this.selection.value); } catch (error) { this.report(error); }
    });
    this.refreshState();
  }

  private selected(): SavedPlan | undefined { return this.plans.find((plan) => plan.id === this.selection.value); }

  private refreshList(id = ''): void {
    this.plans = this.repository?.list() ?? [];
    const option = (label: string, value: string) => {
      const item = document.createElement('option');
      item.textContent = label;
      item.value = value;
      return item;
    };
    this.selection.replaceChildren(option(this.plans.length ? 'Choose a saved plan' : 'No saved plans yet', ''));
    for (const plan of this.plans) this.selection.add(option(plan.name, plan.id));
    this.selection.value = id;
    if (id && this.selected()) this.name.value = this.selected()!.name;
    this.refreshState();
  }

  private refreshState(): void {
    const selected = this.selected();
    if (selected) {
      const working = capturePlan(this.store, this.shapes);
      const matches = JSON.stringify(working) === JSON.stringify({ flightPlan: selected.flightPlan, routeShapes: selected.routeShapes, fuelSettings: selected.fuelSettings });
      this.state.textContent = `${selected.name}: ${matches ? 'matches your current work' : 'current work differs from this saved plan'}.`;
      this.selection.title = selected.name;
    } else { this.state.textContent = ''; this.selection.title = ''; }
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-plan-action]')) {
      const action = button.dataset.planAction;
      const routeNeeded = ['save', 'update', 'export'].includes(action!);
      const selectedNeeded = ['update', 'load', 'duplicate', 'delete'].includes(action!);
      let previous = false;
      try { previous = this.repository?.hasPrevious() ?? false; } catch { /* Storage unavailable. */ }
      button.disabled = this.busy || (action !== 'export' && !this.repository) ||
        (routeNeeded && !this.store.getWaypoints().length) || (selectedNeeded && !selected) ||
        (action === 'previous' && !previous);
    }
  }

  private act(action: string): void {
    if (this.busy) return;
    try {
      if (action === 'export') { this.exportFile(); return; }
      if (!this.repository) throw new Error('Browser storage is unavailable. Export a file to keep your plan.');
      if (action === 'import') { this.file.click(); return; }
      const selected = this.selected();
      if (action === 'save' || action === 'update') {
        if (action === 'update' && !selected) throw new Error('Choose a saved plan to update.');
        const plan = this.repository.save(this.name.value, capturePlan(this.store, this.shapes), action === 'update' ? selected?.id : undefined);
        this.refreshList(plan.id);
        this.report(`${plan.name} ${action === 'update' ? 'updated' : 'saved'}.`);
      } else if (action === 'load' && selected) {
        // Read again so another tab's newer save is not replaced by a stale snapshot.
        const latest = this.repository.list().find((plan) => plan.id === selected.id);
        if (!latest) throw new Error('This plan no longer exists.');
        this.repository.load(latest, this.store, this.shapes);
        this.onLoaded();
        this.refreshList(latest.id);
        this.report(`${latest.name} loaded. Previous work can be restored. Refresh route weather before using forecast winds.`);
      } else if (action === 'duplicate' && selected) {
        const plan = this.repository.duplicate(selected.id);
        this.refreshList(plan.id);
        this.report(`${plan.name} saved as a separate copy.`);
      } else if (action === 'delete' && selected) {
        if (!window.confirm(`Delete the saved plan "${selected.name}"? Your current working route will remain.`)) return;
        this.repository.remove(selected.id);
        this.refreshList();
        this.report('Saved plan deleted.');
      } else if (action === 'previous') {
        this.repository.restorePrevious(this.store, this.shapes);
        this.onLoaded();
        this.report('Previous working plan restored. The plan you just left is now the recovery copy. Refresh route weather before using forecast winds.');
      }
      this.refreshState();
    } catch (error) { this.report(error); }
  }

  private async importFile(): Promise<void> {
    const file = this.file.files?.[0];
    if (!file || !this.repository) return;
    this.busy = true;
    this.refreshState();
    try {
      if (file.size > MAX_PLAN_FILE_BYTES) throw new Error('The plan file is too large (maximum 2 MB).');
      const plan = this.repository.importFile(await file.text());
      this.refreshList(plan.id);
      this.report(`${plan.name} imported. Choose Load selected to open it. Your current work has been kept.`);
    } catch (error) { this.report(error); }
    finally { this.file.value = ''; this.busy = false; this.refreshState(); }
  }

  private exportFile(): void {
    const routeName = this.store.getWaypoints().map((waypoint) => waypoint.name).join(' - ').slice(0, 100);
    const plan = createPlan(this.name.value.trim() || routeName || 'Flight plan', capturePlan(this.store, this.shapes));
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${plan.name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'flight-plan'}.flightplan.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.report('Current plan exported. Keep the file for backup or import it on another device.');
  }

  private report(value: unknown): void {
    this.message.textContent = value instanceof Error ? value.message : String(value);
    this.message.classList.toggle('saved-plans-message--error', value instanceof Error);
  }
}
