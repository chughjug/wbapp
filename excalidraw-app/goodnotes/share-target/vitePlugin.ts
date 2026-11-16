/**
 * Vite plugin that puts the share-target service-worker snippet on disk (and
 * on the dev server) at {@link SHARE_SW_URL}.
 *
 * `vite-plugin-pwa` is configured with `workbox.importScripts: [SHARE_SW_URL]`
 * so the generated `sw.js` pulls this file in at install time. Two notes:
 *
 * - **Ordering.** `importScripts(...)` is emitted at the top of the generated
 *   SW, so our `fetch` listener is registered before workbox's router.
 *   Workbox's `NavigationRoute` only matches `GET`, so the two never fight
 *   over the share `POST`.
 * - **Offline.** Scripts pulled in with `importScripts()` during install are
 *   stored by the browser alongside the SW script itself, so the share target
 *   keeps working with no network.
 *
 * The file is deliberately **not** precached by workbox (it is in
 * `globIgnores`): it is already part of the SW's own script cache, and a
 * second, separately-versioned copy in the precache would only risk serving a
 * stale one.
 */

import { SHARE_SW_FILE_NAME, SHARE_SW_URL } from "./constants";
import { buildShareTargetSwSource } from "./swSource";

import type { Plugin } from "vite";

export const shareTargetSwPlugin = (): Plugin => {
  const source = buildShareTargetSwSource();

  return {
    name: "goodnotes-share-target-sw",
    // serve it in dev too: with VITE_APP_ENABLE_PWA=true the dev service
    // worker also runs `importScripts`, and a 404 there fails SW install
    // outright (which would look like "the PWA is broken", not "the share
    // target is missing").
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) {
          next();
          return;
        }
        const [pathname] = req.url.split("?");
        if (pathname !== SHARE_SW_URL) {
          next();
          return;
        }
        res.setHeader("Content-Type", "application/javascript");
        res.setHeader("Cache-Control", "no-cache");
        res.end(source);
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        // `fileName` (not `name`) so it lands at exactly this path, unhashed:
        // the SW's `importScripts` URL is fixed at config time.
        fileName: SHARE_SW_FILE_NAME,
        source,
      });
    },
  };
};
