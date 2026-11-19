/**
 * `useNewDocument` — create a notebook with an explicit first-page format.
 *
 * Mirrors `useNewPage`: one `open()` for every entry point (shelf New, floating
 * bar, tab "+", Cmd/Ctrl+N, command palette), one dialog to render, and a
 * headless path for hosts that already know the format.
 *
 * On confirm it:
 *   1. flushes any in-flight scene write (so the previous notebook is safe),
 *   2. creates the DocMeta row (honouring optional shelf init such as course),
 *   3. remembers the format for that document,
 *   4. stashes a pending seed (including an optional image File),
 *   5. hands the new meta to `onCreated` so the host can navigate to `/d/<id>`.
 */

import React, { useCallback, useMemo, useRef, useState } from "react";

import { createDoc, flushSceneSaves } from "../library";

import { saveLatexSource, STARTER_SOURCE } from "../latex/store";

import { getStarter } from "../starters/starters";

import { NewPageDialog } from "./NewPageDialog";
import {
  DEFAULT_NEW_PAGE_CHOICE,
  readNewPageChoice,
  writeNewPageChoice,
} from "./newPageChoice";

import { setPendingNewDocumentSeed } from "./pendingNewDocument";

import type { NewPageSubmission } from "./NewPageDialog";
import type { NewPageChoice } from "./newPageChoice";
import type { DocMeta } from "../types";

/** localStorage key for the last create-dialog choice (no document yet). */
export const NEW_DOCUMENT_CHOICE_KEY = "__new-document__";

export interface UseNewDocumentOptions {
  /** Dialog theme. Default `"light"`. */
  theme?: "light" | "dark";
  /**
   * Called after the document row exists and the seed is stashed. The host
   * should navigate to `/d/<id>` (and remount the editor).
   */
  onCreated: (doc: DocMeta) => void;
  /**
   * Run immediately before `createDoc` (e.g. flush the open scene). Errors
   * abort the create.
   */
  onBeforeCreate?: () => void | Promise<void>;
}

export interface UseNewDocumentResult {
  /** Open the format picker. Optional `init` is merged into `createDoc`. */
  open: (init?: Partial<DocMeta>) => void;
  /** Close without creating. */
  close: () => void;
  isOpen: boolean;
  /** Render once at the app root. `null` while closed. */
  dialog: React.ReactElement | null;
  /** Headless create with an explicit format (no dialog). */
  createWithChoice: (
    submission: NewPageSubmission,
    init?: Partial<DocMeta>,
  ) => Promise<DocMeta>;
}

export const useNewDocument = (
  opts: UseNewDocumentOptions,
): UseNewDocumentResult => {
  const [isOpen, setIsOpen] = useState(false);
  const [initial, setInitial] = useState<NewPageChoice>(() =>
    readNewPageChoice(NEW_DOCUMENT_CHOICE_KEY),
  );
  const pendingInitRef = useRef<Partial<DocMeta>>({});
  const onCreatedRef = useRef(opts.onCreated);
  onCreatedRef.current = opts.onCreated;
  const onBeforeCreateRef = useRef(opts.onBeforeCreate);
  onBeforeCreateRef.current = opts.onBeforeCreate;

  const createWithChoice = useCallback<
    UseNewDocumentResult["createWithChoice"]
  >(async (submission, init = {}) => {
    await onBeforeCreateRef.current?.();
    await flushSceneSaves();

    const doc = await createDoc({
      ...pendingInitRef.current,
      ...init,
      defaultTemplate: submission.template,
      defaultPageSize: submission.size,
    });

    const choice: NewPageChoice = {
      template: submission.template,
      size: submission.size,
      landscape: submission.landscape,
      image: !!submission.imageFile,
      imageFit: submission.imageFit,
    };
    writeNewPageChoice(NEW_DOCUMENT_CHOICE_KEY, choice);
    writeNewPageChoice(doc.id, choice);
    setPendingNewDocumentSeed(doc.id, {
      template: submission.template,
      size: submission.size,
      landscape: submission.landscape,
      imageFile: submission.imageFile,
      imageFit: submission.imageFit,
      ...(submission.starterId ? { starterId: submission.starterId } : {}),
    });

    // A LaTeX document needs its source row to exist before the router
    // looks: the route asks `isLatexDoc(id)` and would otherwise mount
    // the notebook editor over it and autosave an empty scene across it.
    const starter = submission.starterId
      ? getStarter(submission.starterId)
      : null;
    if (starter?.latex) {
      await saveLatexSource(doc.id, STARTER_SOURCE);
    }

    pendingInitRef.current = {};
    onCreatedRef.current(doc);
    return doc;
  }, []);

  const open = useCallback((init: Partial<DocMeta> = {}) => {
    pendingInitRef.current = init;
    setInitial(readNewPageChoice(NEW_DOCUMENT_CHOICE_KEY));
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    pendingInitRef.current = {};
    setIsOpen(false);
  }, []);

  const onSubmit = useCallback(
    async (submission: NewPageSubmission) => {
      await createWithChoice(submission);
    },
    [createWithChoice],
  );

  const dialog = useMemo(
    () =>
      isOpen
        ? React.createElement(NewPageDialog, {
            initial: initial ?? DEFAULT_NEW_PAGE_CHOICE,
            theme: opts.theme ?? "light",
            title: "New document",
            submitLabel: "Create",
            starters: true,
            intro:
              "Start from a format, or set the paper, size and orientation yourself. You can add more pages later.",
            onSubmit,
            onClose: close,
          })
        : null,
    [isOpen, initial, opts.theme, onSubmit, close],
  );

  return useMemo(
    () => ({
      open,
      close,
      isOpen,
      dialog,
      createWithChoice,
    }),
    [open, close, isOpen, dialog, createWithChoice],
  );
};
