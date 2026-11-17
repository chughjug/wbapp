/**
 * Fetch Canvas REST JSON using the logged-in session on an open Canvas tab.
 * Runs inside the page so cookies / CSRF meta tags apply.
 */

/** @param {string} url */
export const looksLikeCanvasUrl = (url) => {
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) {
      return false;
    }
    const host = u.hostname.toLowerCase();
    if (host.includes("instructure.com")) {
      return true;
    }
    // school vanity domains often serve /api/v1 or /courses/
    return /\/(courses|calendar|files|grades|api\/v1)\b/i.test(u.pathname);
  } catch {
    return false;
  }
};

/**
 * Prefer an active Canvas tab; otherwise any Canvas tab.
 * @returns {Promise<{ tabId: number, host: string } | null>}
 */
export const findCanvasTab = async () => {
  const tabs = await chrome.tabs.query({});
  const canvasTabs = tabs.filter(
    (t) => t.id != null && t.url && looksLikeCanvasUrl(t.url),
  );
  if (canvasTabs.length === 0) {
    return null;
  }
  const active = canvasTabs.find((t) => t.active) ?? canvasTabs[0];
  const host = new URL(active.url).hostname.toLowerCase();
  return { tabId: active.id, host };
};

/**
 * @param {number} tabId
 * @param {string} apiPath e.g. "courses" or "courses/1/assignments"
 * @param {Record<string, string | number | undefined>} [query]
 */
export const canvasApiInTab = async (tabId, apiPath, query = {}) => {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (path, q) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(q || {})) {
        if (v !== undefined && v !== null && v !== "") {
          params.set(k, String(v));
        }
      }
      const qs = params.toString();
      const url = `/api/v1/${path.replace(/^\//, "")}${qs ? `?${qs}` : ""}`;

      const csrf =
        document
          .querySelector('meta[name="csrf-token"]')
          ?.getAttribute("content") || "";

      const headers = {
        Accept: "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      };

      const all = [];
      let nextUrl = url;
      let pages = 0;
      while (nextUrl && pages < 10) {
        pages += 1;
        const res = await fetch(nextUrl, {
          credentials: "same-origin",
          headers,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(
            `Canvas ${res.status} on ${path}: ${text.slice(0, 200)}`,
          );
        }
        const data = await res.json();
        if (Array.isArray(data)) {
          all.push(...data);
        } else {
          return data;
        }
        const link = res.headers.get("Link") || res.headers.get("link") || "";
        const next = /<([^>]+)>;\s*rel="next"/i.exec(link);
        if (next) {
          try {
            const abs = new URL(next[1], location.origin);
            nextUrl = abs.pathname + abs.search;
          } catch {
            nextUrl = null;
          }
        } else {
          nextUrl = null;
        }
      }
      return all;
    },
    args: [apiPath, query],
  });

  if (result && typeof result === "object" && "error" in /** @type {any} */ (result)) {
    throw new Error(String(/** @type {any} */ (result).error));
  }
  return result;
};

/**
 * Download a file as base64 (capped) using the Canvas tab session.
 * @param {number} tabId
 * @param {string} downloadUrl
 * @param {number} maxBytes
 */
export const fetchFileBase64InTab = async (tabId, downloadUrl, maxBytes) => {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (url, max) => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`File download failed: ${res.status}`);
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > max) {
        return { skipped: true, size: buf.byteLength };
      }
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      return {
        skipped: false,
        size: bytes.length,
        contentType: res.headers.get("content-type") || undefined,
        dataBase64: btoa(binary),
      };
    },
    args: [downloadUrl, maxBytes],
  });
  return result;
};
