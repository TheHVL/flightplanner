import { readPreference, writePreference } from '../utils/preferences';
import { SidebarResize } from './SidebarResize';

export function initializeWorkspaceLayout(workspace: HTMLElement, mapColumn: HTMLElement, mapResizeHandle: HTMLElement, mapExpandButton: HTMLButtonElement, invalidateMap: () => void): void {
  const MIN_WORKSPACE_HEIGHT = 480;
  const MAX_WORKSPACE_HEIGHT = 1000;
  const defaultWorkspaceHeight = Math.min(700, Math.max(560, window.innerHeight - 180));
  const savedWorkspaceHeight = Number(readPreference('flightplanner-workspace-height'));

  const setWorkspaceHeight = (height: number, persist = false) => {
    const clamped = Math.round(Math.min(MAX_WORKSPACE_HEIGHT, Math.max(MIN_WORKSPACE_HEIGHT, height)));
    workspace.style.setProperty('--workspace-height', `${clamped}px`);
    mapResizeHandle.setAttribute('aria-valuenow', String(clamped));
    if (persist) writePreference('flightplanner-workspace-height', String(clamped));
    window.requestAnimationFrame(() => invalidateMap());
  };

  setWorkspaceHeight(Number.isFinite(savedWorkspaceHeight) && savedWorkspaceHeight > 0 ? savedWorkspaceHeight : defaultWorkspaceHeight);
  new SidebarResize(workspace, document.querySelector<HTMLElement>('#planning-sidebar')!,
    document.querySelector<HTMLElement>('#sidebar-resize-handle')!, () => window.requestAnimationFrame(() => invalidateMap()));

  let resizePointerId: number | null = null;
  let resizeStartY = 0;
  let resizeStartHeight = 0;

  const finishMapResize = () => {
    if (resizePointerId === null) return;
    resizePointerId = null;
    document.body.classList.remove('map-resizing');
    const currentHeight = workspace.getBoundingClientRect().height;
    setWorkspaceHeight(currentHeight, true);
  };

  mapResizeHandle.addEventListener('pointerdown', (event) => {
    if (window.matchMedia('(max-width: 900px)').matches) return;
    resizePointerId = event.pointerId;
    resizeStartY = event.clientY;
    resizeStartHeight = workspace.getBoundingClientRect().height;
    mapResizeHandle.setPointerCapture(event.pointerId);
    document.body.classList.add('map-resizing');
    event.preventDefault();
  });

  mapResizeHandle.addEventListener('pointermove', (event) => {
    if (resizePointerId !== event.pointerId) return;
    setWorkspaceHeight(resizeStartHeight + event.clientY - resizeStartY);
  });

  mapResizeHandle.addEventListener('pointerup', (event) => {
    if (resizePointerId !== event.pointerId) return;
    if (mapResizeHandle.hasPointerCapture(event.pointerId)) {
      mapResizeHandle.releasePointerCapture(event.pointerId);
    }
    finishMapResize();
  });

  mapResizeHandle.addEventListener('pointercancel', finishMapResize);
  mapResizeHandle.addEventListener('dblclick', () => setWorkspaceHeight(defaultWorkspaceHeight, true));
  mapResizeHandle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const currentHeight = workspace.getBoundingClientRect().height;
    const delta = event.key === 'ArrowUp' ? -20 : 20;
    setWorkspaceHeight(currentHeight + delta, true);
  });

  const setMapExpanded = (expanded: boolean) => {
    mapColumn.classList.toggle('map-column--expanded', expanded);
    document.body.classList.toggle('map-overlay-open', expanded);
    mapExpandButton.setAttribute('aria-pressed', String(expanded));
    mapExpandButton.textContent = expanded ? '× Exit large map' : '⛶ Expand map';
    window.requestAnimationFrame(() => invalidateMap());
  };

  mapExpandButton.addEventListener('click', () => {
    setMapExpanded(!mapColumn.classList.contains('map-column--expanded'));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mapColumn.classList.contains('map-column--expanded')) setMapExpanded(false);
  });
}
