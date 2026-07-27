/**
 * Sync the extension root's `.dark` class with Fava's active color scheme.
 *
 * Fava stores the user-selected theme in localStorage under the key `theme` and
 * applies it by setting `document.documentElement.style.colorScheme` to one of:
 *   - `"light dark"` — follow the system/browser preference
 *   - `"light"`      — force light mode
 *   - `"dark"`       — force dark mode
 *
 * This helper mirrors that logic: it watches both the inline `style` attribute
 * on `<html>` and the `prefers-color-scheme` media query, and toggles the
 * `dark` class on the extension root accordingly.
 */

function getEffectiveScheme(): "light" | "dark" {
  const explicit = document.documentElement.style.colorScheme;
  if (explicit === "dark") return "dark";
  if (explicit === "light") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function syncFavaTheme(rootEl: HTMLElement): () => void {
  const apply = () => {
    rootEl.classList.toggle("dark", getEffectiveScheme() === "dark");
  };

  apply();

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const onMediaChange = () => apply();
  mediaQuery.addEventListener("change", onMediaChange);

  const observer = new MutationObserver(() => apply());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style"],
  });

  return () => {
    mediaQuery.removeEventListener("change", onMediaChange);
    observer.disconnect();
  };
}
