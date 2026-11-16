/**
 * Navigation helpers that match how `App.tsx` routes today.
 *
 * `GoodNotesRoot` derives its state from `window.location.pathname` and
 * re-reads it on `popstate`. `pushState` does **not** fire `popstate`, so
 * every in-app navigation here pushes the URL and then dispatches the event
 * by hand — the same trick `App.tsx` already uses when it opens a document
 * from the editor.
 *
 * Pass your own `onOpenDocument` / `onCancel` to the components if your host
 * uses a router; these are only the defaults.
 */

/** Canonical URL of a document. */
export const documentUrl = (docId: string): string =>
  `/d/${encodeURIComponent(docId)}`;

const navigate = (url: string, replace: boolean) => {
  if (replace) {
    window.history.replaceState({}, "", url);
  } else {
    window.history.pushState({}, "", url);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
};

/**
 * Open a document.
 *
 * `replace: true` (the default on the share-target route) keeps the
 * `/share-target?shared=…` URL out of the history stack, so Back from the
 * newly opened document goes to the library rather than re-running a
 * consumed import.
 */
export const openDocument = (docId: string, replace = false): void => {
  navigate(documentUrl(docId), replace);
};

/** Go to the document shelf. */
export const openLibrary = (replace = false): void => {
  navigate("/", replace);
};

/** Strip the share query from the address bar without navigating. */
export const clearShareQuery = (): void => {
  if (window.location.search) {
    window.history.replaceState({}, "", window.location.pathname);
  }
};
