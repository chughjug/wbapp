/**
 * "Remember the last new-page choice", per document.
 *
 * Adding ten lined A4 pages should cost one decision, not ten.
 *
 * WHERE IT IS STORED — two tiers, deliberately:
 *
 *  1. **`DocMeta.defaultTemplate` / `DocMeta.defaultPageSize`** (IndexedDB,
 *     via `goodnotes/library`'s `getDoc` / `updateDocMeta`). This is the
 *     integrator-owned contract and the place a document's defaults belong,
 *     so we write through to it. It is asynchronous and only covers the two
 *     fields the contract has.
 *  2. **`localStorage`, keyed per document** — synchronous, available on the
 *     very first render, and able to carry the fields `DocMeta` has no room
 *     for (orientation, image fit). This is the tier the UI actually reads.
 *
 * Reads merge the two: localStorage wins when present (it is never staler),
 * `DocMeta` is the fallback and the cross-device/cleared-storage safety net.
 * `goodnotes/library` and `goodnotes/types` are READ-ONLY for this module and
 * neither was edited.
 */

import { getDoc, updateDocMeta } from "../library";

import type { PageSizeName, PaperTemplateId } from "../types";
import type { PageImageFit } from "../paper/pageImages";

/** What the new-page dialog remembers. */
export interface NewPageChoice {
  /** Ruling drawn on the page. Always a real `PaperTemplateId`. */
  template: PaperTemplateId;
  /** Page geometry preset. */
  size: PageSizeName;
  /** Swap the preset's width and height. */
  landscape: boolean;
  /**
   * `true` when the user last added an *image* page. The image itself is
   * never remembered — each image page needs its own file — but the mode is,
   * so the dialog reopens on the image tab.
   */
  image: boolean;
  /** How the last image background was mapped onto the page. */
  imageFit: PageImageFit;
}

export const DEFAULT_NEW_PAGE_CHOICE: NewPageChoice = {
  template: "lined",
  size: "A4",
  landscape: false,
  image: false,
  imageFit: "cover",
};

const STORAGE_PREFIX = "goodnotes:new-page-choice:";

const storageKey = (docId: string | null | undefined) =>
  `${STORAGE_PREFIX}${docId ?? "__transient__"}`;

/** `/d/<id>` → `<id>`. The editor addresses documents this way. */
export const getCurrentDocId = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const match = window.location.pathname.match(/^\/d\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
};

const sanitize = (
  raw: unknown,
  base: NewPageChoice = DEFAULT_NEW_PAGE_CHOICE,
): NewPageChoice => {
  const value = (raw ?? {}) as Partial<NewPageChoice>;
  return {
    template:
      typeof value.template === "string"
        ? (value.template as PaperTemplateId)
        : base.template,
    size:
      typeof value.size === "string" ? (value.size as PageSizeName) : base.size,
    landscape:
      typeof value.landscape === "boolean" ? value.landscape : base.landscape,
    image: typeof value.image === "boolean" ? value.image : base.image,
    imageFit:
      value.imageFit === "contain" ||
      value.imageFit === "stretch" ||
      value.imageFit === "cover"
        ? value.imageFit
        : base.imageFit,
  };
};

/** Synchronous read of the local tier. Safe in SSR / private mode. */
export const readNewPageChoice = (
  docId: string | null | undefined,
): NewPageChoice => {
  if (typeof localStorage === "undefined") {
    return DEFAULT_NEW_PAGE_CHOICE;
  }
  try {
    const raw = localStorage.getItem(storageKey(docId));
    return raw ? sanitize(JSON.parse(raw)) : DEFAULT_NEW_PAGE_CHOICE;
  } catch {
    return DEFAULT_NEW_PAGE_CHOICE;
  }
};

/** Writes the local tier (sync) and the `DocMeta` tier (fire-and-forget). */
export const writeNewPageChoice = (
  docId: string | null | undefined,
  choice: NewPageChoice,
): void => {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(storageKey(docId), JSON.stringify(choice));
    } catch {
      /* quota / private mode: the DocMeta tier still gets it */
    }
  }
  if (docId) {
    // never block the UI on IndexedDB, and never surface a write failure:
    // the local tier has already recorded the choice.
    void updateDocMeta(docId, {
      defaultTemplate: choice.template,
      defaultPageSize: choice.size,
    }).catch(() => undefined);
  }
};

/**
 * Read the authoritative choice: the `DocMeta` defaults, overlaid with
 * anything the local tier knows. Used once on mount; everything after that
 * goes through the synchronous local tier.
 */
export const loadNewPageChoice = async (
  docId: string | null | undefined,
): Promise<NewPageChoice> => {
  const local = readNewPageChoice(docId);
  if (!docId) {
    return local;
  }
  const hasLocal =
    typeof localStorage !== "undefined" &&
    !!(() => {
      try {
        return localStorage.getItem(storageKey(docId));
      } catch {
        return null;
      }
    })();
  if (hasLocal) {
    return local;
  }
  try {
    const meta = await getDoc(docId);
    if (!meta) {
      return local;
    }
    return sanitize(
      { template: meta.defaultTemplate, size: meta.defaultPageSize },
      local,
    );
  } catch {
    return local;
  }
};
