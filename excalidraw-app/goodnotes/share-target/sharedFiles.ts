/**
 * Page side of the service-worker handoff.
 *
 * The SW cannot hand a `File` to a page that does not exist yet, so it parks
 * the bytes in Cache Storage under {@link SHARE_CACHE_NAME} and redirects to
 * `/share-target?shared=<ids>`. This module is the other half: it reads those
 * entries back as real `File` objects and deletes them.
 *
 * Reading is **destructive by default** ({@link takeSharedFiles}) so a
 * reload, a back-navigation or a second tab can never import the same PDF
 * twice. Use {@link peekSharedFiles} when you only want to look.
 *
 * Everything here degrades to "no shared files" rather than throwing when
 * Cache Storage is unavailable (private mode, non-secure origin, old
 * browsers) — the drop-zone fallback is always there.
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

import type { ShareErrorCode } from "./constants";

/** One file the OS share sheet handed us. */
export interface SharedFile {
  /** Opaque id minted by the service worker; also the cache key suffix. */
  id: string;
  file: File;
  /** `Date.now()` at the moment the SW stashed it. */
  receivedAt: number;
}

const cacheStorage = (): CacheStorage | null => {
  try {
    return typeof caches === "undefined" ? null : caches;
  } catch {
    // some embedded webviews throw on touching `caches` from a non-secure
    // origin rather than leaving it undefined
    return null;
  }
};

const keyFor = (id: string): string =>
  new URL(`${SHARE_CACHE_KEY_PREFIX}${id}`, window.location.origin).href;

const idFromKey = (url: string): string | null => {
  try {
    const { pathname } = new URL(url);
    return pathname.startsWith(SHARE_CACHE_KEY_PREFIX)
      ? pathname.slice(SHARE_CACHE_KEY_PREFIX.length)
      : null;
  } catch {
    return null;
  }
};

const toSharedFile = async (
  id: string,
  response: Response,
): Promise<SharedFile | null> => {
  const blob = await response.blob();
  if (!blob.size) {
    return null;
  }
  const rawName = response.headers.get(SHARE_HEADER_NAME);
  let name = "shared.pdf";
  if (rawName) {
    try {
      name = decodeURIComponent(rawName);
    } catch {
      name = rawName;
    }
  }
  const type =
    response.headers.get(SHARE_HEADER_TYPE) || blob.type || "application/pdf";
  const receivedAt = Number(response.headers.get(SHARE_HEADER_TIME)) || 0;
  return {
    id,
    receivedAt,
    file: new File([blob], name, {
      type,
      lastModified: receivedAt || Date.now(),
    }),
  };
};

/**
 * Ids the service worker put in the URL, in share order.
 *
 * Falls back to "whatever is in the cache" when absent — a shared link that
 * loses its query (or a cold start where the navigation was replayed) should
 * still find the file.
 */
export const readSharedIdsFromUrl = (
  search: string = window.location.search,
): string[] => {
  const value = new URLSearchParams(search).get(SHARE_IDS_PARAM);
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
};

/** The SW's failure code for this navigation, if it reported one. */
export const readShareErrorFromUrl = (
  search: string = window.location.search,
): ShareErrorCode | null => {
  const value = new URLSearchParams(search).get(SHARE_ERROR_PARAM);
  return value === "empty" || value === "failed" ? value : null;
};

/** Is this URL the share-target landing route? */
export const isShareTargetUrl = (
  pathname: string = window.location.pathname,
): boolean => pathname.replace(/\/+$/, "") === SHARE_TARGET_ACTION;

const listEntries = async (ids: string[]): Promise<[string, Response][]> => {
  const store = cacheStorage();
  if (!store) {
    return [];
  }
  let cache: Cache;
  try {
    cache = await store.open(SHARE_CACHE_NAME);
  } catch {
    return [];
  }

  const wanted =
    ids.length > 0
      ? ids
      : (await cache.keys())
          .map((request) => idFromKey(request.url))
          .filter((id): id is string => Boolean(id));

  const entries: [string, Response][] = [];
  for (const id of wanted) {
    const response = await cache.match(keyFor(id));
    if (response) {
      entries.push([id, response]);
    }
  }
  return entries;
};

/**
 * Read the shared files **without** removing them.
 *
 * @param ids restrict to these ids; omit (or pass `[]`) for everything in the
 *   cache, oldest first.
 */
export const peekSharedFiles = async (
  ids: string[] = [],
): Promise<SharedFile[]> => {
  const entries = await listEntries(ids);
  const files: SharedFile[] = [];
  for (const [id, response] of entries) {
    const shared = await toSharedFile(id, response);
    if (shared) {
      files.push(shared);
    }
  }
  return ids.length ? files : files.sort((a, b) => a.receivedAt - b.receivedAt);
};

/** Drop specific entries (or everything) from the share cache. */
export const clearSharedFiles = async (ids: string[] = []): Promise<void> => {
  const store = cacheStorage();
  if (!store) {
    return;
  }
  try {
    const cache = await store.open(SHARE_CACHE_NAME);
    const keys =
      ids.length > 0
        ? ids.map(keyFor)
        : (await cache.keys()).map((request) => request.url);
    await Promise.all(keys.map((key) => cache.delete(key)));
  } catch {
    // nothing to clean up is not an error
  }
};

/**
 * Read the shared files **and** remove them from the cache, so the import
 * cannot be replayed by a reload. This is what the receive route uses.
 */
export const takeSharedFiles = async (
  ids: string[] = [],
): Promise<SharedFile[]> => {
  const files = await peekSharedFiles(ids);
  await clearSharedFiles(files.map((shared) => shared.id));
  return files;
};

/** Cheap "is there anything waiting?" check for a badge or a redirect. */
export const hasPendingSharedFiles = async (): Promise<boolean> => {
  const store = cacheStorage();
  if (!store) {
    return false;
  }
  try {
    const cache = await store.open(SHARE_CACHE_NAME);
    return (await cache.keys()).length > 0;
  } catch {
    return false;
  }
};

/**
 * Put files into the share cache from the page, exactly as the service worker
 * would, and return their ids.
 *
 * Useful for (a) tests and local development, where no OS share sheet exists,
 * and (b) any code that wants to route files through the same receive screen
 * as a real share.
 */
export const stashSharedFiles = async (
  files: readonly File[],
): Promise<string[]> => {
  const store = cacheStorage();
  if (!store) {
    throw new Error("Cache Storage is unavailable, cannot stash shared files");
  }
  const cache = await store.open(SHARE_CACHE_NAME);
  const ids: string[] = [];
  let index = 0;
  for (const file of files) {
    index += 1;
    const id = `${Date.now().toString(36)}-${index}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const headers = new Headers({
      "Content-Type": file.type || "application/octet-stream",
    });
    headers.set(SHARE_HEADER_NAME, encodeURIComponent(file.name));
    headers.set(SHARE_HEADER_TYPE, file.type || "");
    headers.set(SHARE_HEADER_TIME, String(Date.now()));
    await cache.put(new Request(keyFor(id)), new Response(file, { headers }));
    ids.push(id);
  }
  return ids;
};
