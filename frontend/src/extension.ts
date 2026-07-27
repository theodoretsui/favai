import { createElement } from "react";
import { createRoot } from "react-dom/client";

import css from "./index.css?inline";
import App from "./App";
import { setPortalContainer } from "./lib/portal";
import { syncFavaTheme } from "./lib/theme";

/**
 * fava loads this file as an ES module and calls onExtensionPageLoad() when
 * the extension page opens. fava serves no separate CSS for extensions, so
 * the whole stylesheet is inlined above and injected once as <style
 * data-favai>. All markup (including portaled floating elements) lives under
 * `.favai-root` to keep fava's global styles from leaking in and ours from
 * leaking out.
 */
function injectStyles() {
  if (document.querySelector("style[data-favai]")) {
    return;
  }
  const style = document.createElement("style");
  style.setAttribute("data-favai", "");
  style.textContent = css;
  document.head.appendChild(style);
}

export default {
  onExtensionPageLoad() {
    injectStyles();
    const mountPoint = document.getElementById("favaiApp");
    if (!mountPoint) {
      return;
    }
    mountPoint.innerHTML = "";
    const rootEl = document.createElement("div");
    rootEl.className = "favai-root min-h-screen";
    mountPoint.appendChild(rootEl);
    syncFavaTheme(rootEl);
    setPortalContainer(rootEl);
    createRoot(rootEl).render(createElement(App));
  },
};
