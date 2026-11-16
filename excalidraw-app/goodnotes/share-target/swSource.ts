/**
 * Source of the service-worker snippet that answers the share-target POST.
 *
 * ## Why this is a string and not a `.js` file
 *
 * `workbox`'s `generateSW` strategy (what `vite-plugin-pwa` uses here) builds
 * the whole service worker itself; the only supported way to add our own
 * `fetch` listener to it is `workbox.importScripts`, which needs a **URL**
 * that the SW can `importScripts()` at install time. So a file has to exist
 * in the build output at a known path.
 *
 * Generating that file from this string (see `vitePlugin.ts`) rather than
 * copying a checked-in `.js` means:
 * - the constants in `constants.ts` are the single source of truth — the SW
 *   and the page can never drift apart on the cache name or the redirect URL;
 * - nothing has to resolve a path relative to `vite.config.mts` at config
 *   time (Vite evaluates the config from a generated temp file, so
 *   `import.meta.url` there does **not** point where you'd expect);
 * - there is no stray `.js` in `excalidraw-app/` for `tsc`/eslint to trip on.
 *
 * ## What the snippet does
 *
 * `importScripts()` runs at the very top of the generated SW, so this `fetch`
 * listener is registered **before** workbox's router. It only ever claims
 * `POST` requests to the share action; every other request (including the
 * `GET /share-target?shared=…` navigation that follows the redirect) falls
 * through to workbox untouched.
 *
 * The file bytes are parked in Cache Storage and the response is a **303
 * redirect** to the same path with the ids in the query. Redirecting (rather
 * than rendering the app straight from the POST response) is the standard
 * Web Share Target recipe: it leaves a normal, reloadable GET URL in the
 * address bar instead of a POST the browser would offer to re-submit.
 */

import {
  SHARE_CACHE_KEY_PREFIX,
  SHARE_CACHE_NAME,
  SHARE_ERROR_PARAM,
  SHARE_HEADER_NAME,
  SHARE_HEADER_TIME,
  SHARE_HEADER_TYPE,
  SHARE_IDS_PARAM,
  SHARE_TARGET_ACTION,
} from "./constants";

/** Everything the snippet needs, baked in as a JSON literal. */
const config = () =>
  JSON.stringify(
    {
      action: SHARE_TARGET_ACTION,
      cacheName: SHARE_CACHE_NAME,
      keyPrefix: SHARE_CACHE_KEY_PREFIX,
      idsParam: SHARE_IDS_PARAM,
      errorParam: SHARE_ERROR_PARAM,
      headerName: SHARE_HEADER_NAME,
      headerType: SHARE_HEADER_TYPE,
      headerTime: SHARE_HEADER_TIME,
    },
    null,
    2,
  );

/**
 * The JS served at {@link SHARE_SW_URL} and `importScripts`-ed by the
 * generated service worker. Plain ES2017, no modules, no workbox APIs.
 */
export const buildShareTargetSwSource = (): string => `/*
 * GoodNotes share-target handler — GENERATED, do not edit.
 * Source: excalidraw-app/goodnotes/share-target/swSource.ts
 *
 * Imported at the top of the workbox-generated service worker via
 * \`workbox.importScripts\`, so this fetch listener runs before workbox's
 * router and can claim the share POST.
 */
(function () {
  "use strict";

  var CONFIG = ${config()};

  var counter = 0;

  function makeId() {
    counter += 1;
    var random = Math.random().toString(36).slice(2, 10);
    return Date.now().toString(36) + "-" + counter + "-" + random;
  }

  /** Same-origin 303 back to the SPA, carrying ids (or an error code). */
  function redirect(query) {
    var target = new URL(CONFIG.action, self.location.origin);
    target.search = query;
    return Response.redirect(target.href, 303);
  }

  /** Blob-ish form values only: strings in the form are title/text/url. */
  function isFileLike(value) {
    return (
      value &&
      typeof value === "object" &&
      typeof value.arrayBuffer === "function"
    );
  }

  async function stashSharedFiles(request) {
    var formData;
    try {
      formData = await request.formData();
    } catch (error) {
      return redirect(CONFIG.errorParam + "=failed");
    }

    var files = [];
    formData.forEach(function (value) {
      if (isFileLike(value)) {
        files.push(value);
      }
    });

    if (!files.length) {
      return redirect(CONFIG.errorParam + "=empty");
    }

    var ids = [];
    try {
      var cache = await caches.open(CONFIG.cacheName);
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        var id = makeId();
        var headers = {
          "Content-Type": file.type || "application/octet-stream",
          "Content-Length": String(file.size),
        };
        headers[CONFIG.headerName] = encodeURIComponent(
          file.name || "shared.pdf",
        );
        headers[CONFIG.headerType] = file.type || "";
        headers[CONFIG.headerTime] = String(Date.now());
        await cache.put(
          new Request(
            new URL(CONFIG.keyPrefix + id, self.location.origin).href,
          ),
          new Response(file, { headers: headers }),
        );
        ids.push(id);
      }
    } catch (error) {
      return redirect(CONFIG.errorParam + "=failed");
    }

    return redirect(
      CONFIG.idsParam + "=" + encodeURIComponent(ids.join(",")),
    );
  }

  self.addEventListener("fetch", function (event) {
    var request = event.request;
    if (!request || request.method !== "POST") {
      return;
    }
    var url;
    try {
      url = new URL(request.url);
    } catch (error) {
      return;
    }
    if (url.origin !== self.location.origin || url.pathname !== CONFIG.action) {
      return;
    }
    event.respondWith(stashSharedFiles(request));
  });
})();
`;
