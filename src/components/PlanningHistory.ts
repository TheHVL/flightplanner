import type { FlightPlanStore } from '../flightplan/FlightPlanStore';

export class PlanningHistory {
  constructor(private readonly root: HTMLElement, private readonly store: FlightPlanStore) {
    root.innerHTML = '<button type="button" class="ghost-button" data-plan-undo>Undo</button><button type="button" class="ghost-button" data-plan-redo>Redo</button>';
    root.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-plan-undo]')) store.undoLastAction();
      if (target.closest('[data-plan-redo]')) store.redoLastAction();
    });
    document.addEventListener('keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
      const key = event.key.toLowerCase();
      const redo = (key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey);
      const undo = key === 'z' && !event.shiftKey;
      if (!undo && !redo) return;
      if (redo ? !store.canRedo() : !store.canUndo()) return;
      event.preventDefault();
      if (redo) store.redoLastAction(); else store.undoLastAction();
    });
    store.subscribe(() => this.render());
    this.render();
  }
  private render(): void {
    this.root.querySelector<HTMLButtonElement>('[data-plan-undo]')!.disabled = !this.store.canUndo();
    this.root.querySelector<HTMLButtonElement>('[data-plan-redo]')!.disabled = !this.store.canRedo();
  }
}
