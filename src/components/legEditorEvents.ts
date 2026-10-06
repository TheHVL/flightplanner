export const OPEN_LEG_EDITOR = 'flightplanner-open-leg-editor';
export const LEG_SELECTED = 'flightplanner-leg-selected';
export interface LegEditorRequest {
  fromId: string;
  toId: string;
  focus?: 'pl' | 'msa' | 'frequency' | 'waypoint';
  waypointId?: string;
}
export function openLegEditor(detail: LegEditorRequest): void {
  window.dispatchEvent(new CustomEvent(OPEN_LEG_EDITOR, { detail }));
}
