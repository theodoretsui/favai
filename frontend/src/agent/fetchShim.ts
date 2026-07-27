/**
 * Fetch shim: rewrites requests to a sentinel domain to the favai proxy endpoint.
 *
 * The pi-ai SDK constructs URLs by appending provider-specific paths (e.g.
 * ``/chat/completions``) to the ``Model``'s ``baseUrl``.  Fava's extension
 * endpoint routing uses a single-segment ``<endpoint>`` (no slashes), so we
 * cannot use a sub-path endpoint directly.  Instead we set ``baseUrl`` to a
 * sentinel domain and intercept the request with a global ``fetch`` wrapper.
 *
 * Only requests to ``https://favai-proxy.invalid`` are rewritten; all other
 * ``fetch`` calls pass through unchanged.
 */

export const SENTINEL = "https://favai-proxy.invalid";

const origFetch = window.fetch.bind(window);

window.fetch = (input, init) => {
  const url = typeof input === "string" ? input : (input as Request)?.url;
  if (!url || !url.startsWith(SENTINEL)) {
    return origFetch(input, init);
  }

  const upstream = url.slice(SENTINEL.length);
  const basePath = window.location.pathname.endsWith("/")
    ? window.location.pathname
    : `${window.location.pathname}/`;

  const headers = new Headers(init?.headers);
  headers.set("X-Favai-Upstream", upstream);
  // Strip dummy auth headers sent by the SDK — the backend injects the real key.
  headers.delete("authorization");
  headers.delete("x-api-key");

  return origFetch(`${basePath}llm_proxy`, {
    ...init,
    headers,
  });
};
