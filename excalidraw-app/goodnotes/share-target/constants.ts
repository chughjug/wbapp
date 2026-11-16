/**
 * Wire-format constants shared by the three places that have to agree:
 *
 * 1. the **manifest** (`vite.config.mts` spreads {@link SHARE_TARGET_MANIFEST}),
 * 2. the **service worker** snippet (`swSource.ts` bakes these into the JS it
 *    generates — the SW cannot `import` a TypeScript module),
 * 3. the **page** (`sharedFiles.ts`, `ShareTargetReceiver.tsx`).
 *
 * Keep this file free of browser- and React-only imports: `vite.config.mts`
 * imports it at config-evaluation time, in Node.
 */

/**
 * The URL the OS share sheet POSTs the shared file to, and — after the
 * service worker's 303 — the URL the app lands on.
 *
 * The same path serves both methods on purpose:
 * - `POST /share-target` is answered by our service worker (workbox's
 *   `NavigationRoute` only matches GET, so it never sees it);
 * - `GET /share-target?shared=…` falls through to the SPA
 *   (`navigateFallback` → `index.html`, plus the `vercel.json` rewrite for a
 *   cold visit with no service worker installed).
 *
 * This is why the route must **not** be added to `navigateFallbackDenylist`:
 * denylisting it would send the post-redirect GET to the static host, which
 * has no `/share-target` file to serve.
 */
export const SHARE_TARGET_ACTION = "/share-target";

/** `name` of the manifest file param, and of the multipart field. */
export const SHARE_TARGET_FILE_FIELD = "file";

/** MIME types / extensions we tell the OS we can receive. */
export const SHARE_TARGET_ACCEPT = ["application/pdf", ".pdf"] as const;

/** Cache Storage bucket the SW parks the shared bytes in for the page. */
export const SHARE_CACHE_NAME = "goodnotes-share-target-v1";

/** Key prefix for one shared file inside {@link SHARE_CACHE_NAME}. */
export const SHARE_CACHE_KEY_PREFIX = "/__goodnotes-share/";

/** Query param carrying the comma-separated ids of the stashed files. */
export const SHARE_IDS_PARAM = "shared";

/** Query param carrying a failure code when the SW could not stash anything. */
export const SHARE_ERROR_PARAM = "shareError";

/** Failure codes the SW can put in {@link SHARE_ERROR_PARAM}. */
export const SHARE_ERROR_CODES = {
  /** The POST carried no file part at all. */
  empty: "empty",
  /** `request.formData()` threw, or the cache write failed. */
  failed: "failed",
} as const;

export type ShareErrorCode = keyof typeof SHARE_ERROR_CODES;

/** Response headers the SW writes so the page can rebuild a real `File`. */
export const SHARE_HEADER_NAME = "x-goodnotes-share-name";
export const SHARE_HEADER_TYPE = "x-goodnotes-share-type";
export const SHARE_HEADER_TIME = "x-goodnotes-share-time";

/** Public URL of the generated SW snippet (see `vitePlugin.ts`). */
export const SHARE_SW_URL = "/share-target-sw.js";

/** File name of that snippet in the build output. */
export const SHARE_SW_FILE_NAME = "share-target-sw.js";

/**
 * The `share_target` member for the web app manifest.
 *
 * PDF-only on purpose: the OS share sheet should not advertise a file type
 * this app cannot turn into a document. (The pre-existing
 * `application/vnd.excalidraw+json` entry pointed at `/web-share-target`,
 * which nothing in this fork serves — `/` renders the document shelf, not the
 * editor that reads upstream's `web-share-target` cache — so it was dead
 * weight. See INTEGRATION.md § "What changed in vite.config.mts".)
 */
export const SHARE_TARGET_MANIFEST = {
  action: SHARE_TARGET_ACTION,
  // `as const` on the individual literals, not on the object: the manifest
  // type in vite-plugin-pwa wants a *mutable* `files` array, so a deeply
  // readonly object would not be assignable.
  method: "POST" as const,
  enctype: "multipart/form-data",
  params: {
    title: "title",
    text: "text",
    url: "url",
    files: [
      {
        name: SHARE_TARGET_FILE_FIELD,
        accept: [...SHARE_TARGET_ACCEPT],
      },
    ],
  },
};
