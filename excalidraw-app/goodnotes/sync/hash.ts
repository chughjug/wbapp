/**
 * Content hashing — the thing that decides "has this device changed since the
 * last sync?".
 *
 * Why not `updatedAt`? Because the library bumps `updatedAt` on writes that
 * are not edits at all: applying a *pulled* scene goes through `saveScene`,
 * which stamps `Date.now()`. A timestamp-based dirty flag would therefore
 * mark every pulled document as locally modified and push it straight back,
 * ping-ponging versions between devices forever. A content hash does not lie.
 *
 * What is hashed, and what is deliberately not:
 *
 *  - **elements**: `id`, `version`, `versionNonce` and the deleted flag, in
 *    document order. Excalidraw maintains these per element and they survive
 *    a JSON round-trip, so two devices holding the same scene compute the
 *    same hash. Hashing the full element JSON would be correct too, but it is
 *    megabytes of string building on every keystroke-equivalent.
 *  - **file ids**: added or removed images change the hash; the (large) image
 *    bytes never need to be read to notice.
 *  - **metadata**: title, course, due date, tags, page count, paper defaults.
 *  - **NOT `appState`**: it holds `scrollX`, `scrollY` and `zoom`. Hashing it
 *    would mark a document dirty for panning the canvas, so scrolling on one
 *    device would fight the other for versions.
 *  - **NOT the thumbnail**: it is regenerated locally and `setThumbnail`
 *    deliberately does not count as an edit.
 */

import type { DocMeta, DocScene } from "../types";

/** FNV-1a, 32-bit, as 8 lowercase hex digits. */
const fnv1a = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    // eslint-disable-next-line no-bitwise
    hash ^= input.charCodeAt(i);
    // hash *= 16777619, kept in 32 bits without relying on bitwise overflow
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

/** Stable signature of a scene's elements and attached files. */
export const sceneSignature = (scene: DocScene | null): string => {
  if (!scene) {
    return "empty";
  }
  const parts: string[] = [];
  for (const element of scene.elements) {
    parts.push(
      `${element.id}:${element.version}:${element.versionNonce}:${
        element.isDeleted ? 1 : 0
      }`,
    );
  }
  const fileIds = Object.keys(scene.files ?? {}).sort();
  return `${parts.join(",")}|${fileIds.join(",")}`;
};

/** Hash of the metadata half alone — see `DocSyncState.baseMetaHash`. */
export const metaHash = (meta: DocMeta): string => fnv1a(metaSignature(meta));

/** Stable signature of the metadata fields a user can actually change. */
export const metaSignature = (meta: DocMeta): string =>
  [
    meta.title,
    meta.course ?? "",
    meta.dueDate ?? "",
    [...meta.tags].sort().join("\u0001"),
    meta.pageCount,
    meta.defaultTemplate,
    meta.defaultPageSize,
    meta.defaultLandscape ? 1 : 0,
    meta.defaultImageFit ?? "",
  ].join("\u0000");

/**
 * The hash stored as `baseContentHash` and pushed as the row's
 * `content_hash`. Two devices holding the same document compute the same
 * value; any user-visible change to either half changes it.
 */
export const contentHash = (meta: DocMeta, scene: DocScene | null): string =>
  `${fnv1a(metaSignature(meta))}-${fnv1a(sceneSignature(scene))}`;
