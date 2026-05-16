/**
 * Helpers for calling Coursera's internal REST APIs from within a content script.
 *
 * Content scripts run in an isolated JS world but share the page's origin for
 * network requests, so `fetch` calls to coursera.org work with credentials.
 * The one thing content scripts CANNOT access is `window.App` / `window.__APOLLO_STATE__`
 * (those live in the page's MAIN world). We bridge that gap by injecting a tiny
 * inline <script> that reads the values and posts them back via postMessage.
 */

import * as logger from "../../shared/logger";

// ─── URL helpers ─────────────────────────────────────────────────────────────

/** Extract the course slug from the current page URL, e.g. "machine-learning" */
export function getCourseSlug(): string | null {
  const m = location.pathname.match(/\/learn\/([^/?#]+)/);
  return m ? m[1] : null;
}

/** Extract the item ID from paths like /learn/{slug}/lecture/{itemId} */
export function getItemId(): string | null {
  const m = location.pathname.match(/\/learn\/[^/]+\/[^/]+\/([^/?#]+)/);
  return m ? m[1] : null;
}

// ─── CSRF token ───────────────────────────────────────────────────────────────

/** Read CSRF token from meta tag or cookie (both accessible in content scripts). */
export function getCsrfToken(): string {
  // 1. <meta name="csrf-token"> — Coursera sometimes places this
  const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
  if (meta?.content) return meta.content;

  // 2. CSRF3-Token cookie (not httpOnly)
  const cookie = document.cookie
    .split("; ")
    .find((c) => c.startsWith("CSRF3-Token="));
  if (cookie) {
    const val = cookie.split("=")[1];
    if (val) return decodeURIComponent(val);
  }

  // 3. csrftoken cookie (fallback)
  const csrf2 = document.cookie
    .split("; ")
    .find((c) => c.startsWith("csrftoken="));
  if (csrf2) {
    const val = csrf2.split("=")[1];
    if (val) return decodeURIComponent(val);
  }

  return "";
}

// ─── User ID (requires page MAIN world access) ────────────────────────────────

let _cachedUserId: string | null = null;

/**
 * Get the logged-in Coursera user ID by injecting an inline script into the
 * page's MAIN JS world (which can read window.App / __APOLLO_STATE__), then
 * receiving the value back via postMessage.
 */
export async function getUserId(): Promise<string | null> {
  if (_cachedUserId) return _cachedUserId;

  return new Promise<string | null>((resolve) => {
    const MSG_TYPE = "__RABBITRAMP_USER_ID__";
    const timeout = setTimeout(() => {
      window.removeEventListener("message", handler);
      logger.warn("courseraApi", "getUserId timed out — userId not found");
      resolve(null);
    }, 2000);

    function handler(e: MessageEvent) {
      if (
        e.source === window &&
        e.data &&
        typeof e.data === "object" &&
        e.data.type === MSG_TYPE
      ) {
        clearTimeout(timeout);
        window.removeEventListener("message", handler);
        const id = typeof e.data.userId === "string" ? e.data.userId : null;
        _cachedUserId = id;
        resolve(id);
      }
    }

    window.addEventListener("message", handler);

    // Inject a <script> that runs in MAIN world — can read window.App etc.
    const script = document.createElement("script");
    script.textContent = `(function(){
      try {
        var uid =
          (window.App &&
            window.App.context &&
            window.App.context.dispatcher &&
            window.App.context.dispatcher.stores &&
            window.App.context.dispatcher.stores.ApplicationStore &&
            window.App.context.dispatcher.stores.ApplicationStore.userData &&
            window.App.context.dispatcher.stores.ApplicationStore.userData.id) ||
          (function(){
            var s = window.__APOLLO_STATE__;
            if (!s) return null;
            var keys = Object.keys(s);
            for (var i = 0; i < keys.length; i++) {
              var v = s[keys[i]];
              if (v && v.__typename === 'User' && v.id) return v.id;
            }
            return null;
          })() ||
          (window.__INITIAL_STATE__ &&
            window.__INITIAL_STATE__.user &&
            window.__INITIAL_STATE__.user.id) ||
          null;
        window.postMessage({ type: '${MSG_TYPE}', userId: uid }, '*');
      } catch(e) {
        window.postMessage({ type: '${MSG_TYPE}', userId: null }, '*');
      }
    })();`;
    document.documentElement.appendChild(script);
    script.remove();
  });
}

// ─── Fetch wrapper ────────────────────────────────────────────────────────────

/**
 * Make an authenticated request to a Coursera internal API.
 * Content scripts share the page's origin so cookies are sent automatically.
 */
export async function callCourseraApi(
  method: "GET" | "POST" | "PUT" | "PATCH",
  url: string,
  body?: unknown
): Promise<Response> {
  const csrf = getCsrfToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
  };
  if (csrf) {
    headers["X-CSRFToken"] = csrf;
    headers["X-CSRF3-Token"] = csrf;
  }

  const res = await fetch(url, {
    method,
    credentials: "include",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  return res;
}
