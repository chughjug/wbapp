/**
 * `useNewPage` — the one place the "add a page" flow lives.
 *
 * It owns the dialog's open state, the remembered per-document choice and
 * the actual insertion (including hashing an image into the editor's
 * `BinaryFiles`), and exposes:
 *
 *   - `open()`  — a bare callback, so any button anywhere can trigger the
 *                 flow (the nav bar's add-page action, the page panel's
 *                 "+ Add page", a keyboard shortcut…),
 *   - `dialog`  — the element to render once, somewhere in the tree,
 *   - `addPageWithChoice()` — the headless path: add a page with an explicit
 *                 format and no UI at all,
 *   - `repeatLastChoice()`  — add another page exactly like the last one.
 *
 * Deliberately NOT a context: one host renders `dialog` and hands `open`
 * around, which keeps the module free of provider wiring.
 */

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { syncPageImageCache } from "../paper/pageImages";

import { NewPageDialog } from "./NewPageDialog";
import { addPage as addPageToElements } from "./pageModel";
import { attachPageImageFile } from "./pageImageFile";
import {
  DEFAULT_NEW_PAGE_CHOICE,
  getCurrentDocId,
  loadNewPageChoice,
  readNewPageChoice,
  writeNewPageChoice,
} from "./newPageChoice";
import { scrollToPage } from "./scrollToPage";

import type { NewPageSubmission } from "./NewPageDialog";
import type { NewPageChoice } from "./newPageChoice";
import type { PageImageBackground, PageImageFit } from "../paper/pageImages";
import type { PageSizeName, PaperTemplateId } from "../types";

/** An explicit, UI-free description of the page to create. */
export interface NewPageRequest {
  template?: PaperTemplateId;
  size?: PageSizeName;
  landscape?: boolean;
  /** 0-based insert position. Defaults to the end of the document. */
  at?: number;
  /** An image to use as the page background (hashed into `BinaryFiles`). */
  imageFile?: File | null;
  /** Or an already-stored background (same `fileId` reused across pages). */
  image?: PageImageBackground | null;
  imageFit?: PageImageFit;
  /** Scroll the viewport to the new page. Default `true`. */
  scrollTo?: boolean;
  /** Record this as the document's remembered choice. Default `true`. */
  remember?: boolean;
}

export interface UseNewPageOptions {
  /** Document id for the remembered choice. Defaults to `/d/<id>` in the URL. */
  docId?: string | null;
  /** Dialog theme. Defaults to the editor's current theme. */
  theme?: "light" | "dark";
  /** Insert position used by the dialog. Defaults to the end. */
  at?: number;
  /** Called after a page lands in the scene. */
  onAdded?: (index: number) => void;
}

export interface UseNewPageResult {
  /** Open the format picker. */
  open: () => void;
  /** Close it without adding anything. */
  close: () => void;
  isOpen: boolean;
  /** Render this once. `null` while closed. */
  dialog: React.ReactElement | null;
  /** The remembered choice for this document. */
  choice: NewPageChoice;
  /** Headless insertion. Resolves with the new page's 0-based index. */
  addPageWithChoice: (request?: NewPageRequest) => Promise<number>;
  /** Add another page exactly like the last one (no image). */
  repeatLastChoice: () => Promise<number>;
}

export const useNewPage = (
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  opts: UseNewPageOptions = {},
): UseNewPageResult => {
  const docId = opts.docId !== undefined ? opts.docId : getCurrentDocId();
  const [isOpen, setIsOpen] = useState(false);
  const [choice, setChoice] = useState<NewPageChoice>(() =>
    readNewPageChoice(docId),
  );
  const choiceRef = useRef(choice);
  choiceRef.current = choice;

  // one async reconciliation with DocMeta on mount (see ./newPageChoice)
  useEffect(() => {
    let cancelled = false;
    void loadNewPageChoice(docId).then((loaded) => {
      if (!cancelled) {
        setChoice(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const addPageWithChoice = useCallback<UseNewPageResult["addPageWithChoice"]>(
    async (request = {}) => {
      if (!excalidrawAPI) {
        return -1;
      }
      const base = choiceRef.current ?? DEFAULT_NEW_PAGE_CHOICE;
      const template = request.template ?? base.template;
      const size = request.size ?? base.size;
      const landscape = request.landscape ?? base.landscape;
      const imageFit = request.imageFit ?? base.imageFit;

      let image: PageImageBackground | null = request.image ?? null;
      if (!image && request.imageFile) {
        // addFiles BEFORE the element, so the scene never references a
        // fileId the editor cannot resolve (same ordering as import-pdf).
        image = await attachPageImageFile(excalidrawAPI, request.imageFile, {
          fit: imageFit,
        });
      }

      const result = addPageToElements(
        excalidrawAPI.getSceneElementsIncludingDeleted(),
        {
          at: request.at,
          size,
          template,
          landscape,
          image,
        },
      );

      excalidrawAPI.updateScene({
        elements: result.elements,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });

      // the background layer paints from a decoded-image cache; prime it now
      // so the new page is not a placeholder for a frame or two
      syncPageImageCache(result.elements, excalidrawAPI.getFiles());

      if (request.remember !== false) {
        const next: NewPageChoice = {
          template,
          size,
          landscape,
          image: !!image,
          imageFit,
        };
        setChoice(next);
        choiceRef.current = next;
        writeNewPageChoice(docId, next);
      }

      if (request.scrollTo !== false) {
        requestAnimationFrame(() => scrollToPage(excalidrawAPI, result.index));
      }
      opts.onAdded?.(result.index);
      return result.index;
    },
    // `opts.onAdded` is read through the closure on purpose; callers pass an
    // inline lambda and we do not want to rebuild the callback every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [excalidrawAPI, docId],
  );

  const repeatLastChoice = useCallback(
    () => addPageWithChoice({ image: null, imageFile: null }),
    [addPageWithChoice],
  );

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const onSubmit = useCallback(
    async (submission: NewPageSubmission) => {
      await addPageWithChoice({
        template: submission.template,
        size: submission.size,
        landscape: submission.landscape,
        imageFile: submission.imageFile,
        imageFit: submission.imageFit,
        at: opts.at,
      });
    },
    [addPageWithChoice, opts.at],
  );

  const theme =
    opts.theme ??
    ((excalidrawAPI?.getAppState?.().theme as "light" | "dark") || "light");

  const dialog = useMemo(
    () =>
      isOpen && excalidrawAPI
        ? React.createElement(NewPageDialog, {
            initial: choice,
            theme,
            onSubmit,
            onClose: close,
          })
        : null,
    [isOpen, excalidrawAPI, choice, theme, onSubmit, close],
  );

  return useMemo(
    () => ({
      open,
      close,
      isOpen,
      dialog,
      choice,
      addPageWithChoice,
      repeatLastChoice,
    }),
    [open, close, isOpen, dialog, choice, addPageWithChoice, repeatLastChoice],
  );
};
