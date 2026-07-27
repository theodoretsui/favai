/**
 * Portal container for floating UI (Select, Combobox, tooltips...).
 *
 * fava has its own global styles; floating elements portaled to <body> would
 * escape `.favai-root`, lose the scoped CSS variables and risk being covered
 * by fava's stacking contexts. All portals are therefore redirected into the
 * extension root element, which is registered here on mount.
 */
let container: HTMLElement | null = null;

export function setPortalContainer(el: HTMLElement): void {
  container = el;
}

export function getPortalContainer(): HTMLElement | undefined {
  return container ?? undefined;
}
