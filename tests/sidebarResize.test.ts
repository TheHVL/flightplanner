// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarResize } from '../src/components/SidebarResize';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); document.body.className = ''; });
function mount(width = 1200) {
  vi.stubGlobal('innerWidth', width);
  const workspace = document.createElement('main');
  const sidebar = document.createElement('aside');
  const handle = document.createElement('div');
  workspace.append(sidebar, handle); document.body.replaceChildren(workspace);
  let availableWidth = width;
  workspace.getBoundingClientRect = () => ({width:availableWidth}) as DOMRect;
  sidebar.getBoundingClientRect = () => ({width:parseFloat(workspace.style.getPropertyValue('--sidebar-width'))}) as DOMRect;
  handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = () => false; handle.releasePointerCapture = vi.fn();
  const onResize = vi.fn();
  new SidebarResize(workspace, sidebar, handle, onResize);
  return { workspace, handle, onResize, setWidth:(value:number) => { availableWidth = value; vi.stubGlobal('innerWidth',value); window.dispatchEvent(new Event('resize')); } };
}
describe('sidebar resizing', () => {
  it('supports keyboard resizing, remembers the width, and reserves map space on a smaller screen', () => {
    localStorage.clear();
    const {workspace, handle, setWidth} = mount();
    handle.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight'}));
    expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('360px');
    expect(localStorage.getItem('flightplanner-sidebar-width')).toBe('360');
    handle.dispatchEvent(new KeyboardEvent('keydown', {key:'End'}));
    expect(handle.getAttribute('aria-valuenow')).toBe('760');
    setWidth(950);
    expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('536px');
    setWidth(1200);
    expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('760px');
    const restored = mount();
    expect(restored.handle.getAttribute('aria-valuenow')).toBe('760');
    restored.handle.dispatchEvent(new MouseEvent('dblclick'));
    expect(restored.handle.getAttribute('aria-valuenow')).toBe('340');
  });
  it('drags without losing capture, limits the width, and saves when the drag ends', () => {
    localStorage.clear();
    const {workspace, handle, onResize} = mount();
    handle.dispatchEvent(new PointerEvent('pointerdown', {pointerId:1,clientX:340,button:0}));
    handle.dispatchEvent(new PointerEvent('pointermove', {pointerId:2,clientX:700}));
    expect(handle.getAttribute('aria-valuenow')).toBe('340');
    handle.dispatchEvent(new PointerEvent('pointermove', {pointerId:1,clientX:540}));
    expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('540px');
    handle.dispatchEvent(new PointerEvent('pointerup', {pointerId:1}));
    expect(localStorage.getItem('flightplanner-sidebar-width')).toBe('540');
    expect(document.body.classList.contains('sidebar-resizing')).toBe(false);
    expect(onResize).toHaveBeenCalled();
  });
});
