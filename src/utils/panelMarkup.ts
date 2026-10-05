/** Keep the user's expanded subsections when calculated panels refresh. */
export function setPanelMarkup(element: HTMLElement, markup: string): void {
  const state = new Map(Array.from(element.querySelectorAll<HTMLDetailsElement>('details[data-menu-section]'))
    .map((section) => [section.dataset.menuSection, section.open]));
  element.innerHTML = markup;
  for (const section of element.querySelectorAll<HTMLDetailsElement>('details[data-menu-section]')) {
    const open = state.get(section.dataset.menuSection);
    if (open !== undefined) section.open = open;
  }
}
