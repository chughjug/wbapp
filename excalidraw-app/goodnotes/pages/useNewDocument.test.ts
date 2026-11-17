/**
 * Headless create path for `useNewDocument` — the dialog itself is covered by
 * manual UI checks; this exercises createDoc + choice stash + pending seed.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteDoc, getDoc, listDocs } from "../library";

import { readNewPageChoice } from "./newPageChoice";
import {
  clearPendingNewDocumentSeeds,
  takePendingNewDocumentSeed,
} from "./pendingNewDocument";
import { NEW_DOCUMENT_CHOICE_KEY, useNewDocument } from "./useNewDocument";

const wipeDocs = async () => {
  for (const doc of await listDocs()) {
    await deleteDoc(doc.id);
  }
};

describe("useNewDocument", () => {
  beforeEach(async () => {
    clearPendingNewDocumentSeeds();
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    await wipeDocs();
  });

  it("createWithChoice writes meta, remembers the choice, and stashes a seed", async () => {
    const onCreated = vi.fn();
    const { result } = renderHook(() =>
      useNewDocument({ theme: "light", onCreated }),
    );

    let docId = "";
    await act(async () => {
      const doc = await result.current.createWithChoice({
        template: "grid",
        size: "LETTER",
        landscape: true,
        imageFile: null,
        imageFit: "cover",
      });
      docId = doc.id;
    });

    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated.mock.calls[0][0].id).toBe(docId);

    const meta = await getDoc(docId);
    expect(meta?.defaultTemplate).toBe("grid");
    expect(meta?.defaultPageSize).toBe("LETTER");

    const docs = await listDocs();
    expect(docs.some((d) => d.id === docId)).toBe(true);

    expect(readNewPageChoice(docId)).toMatchObject({
      template: "grid",
      size: "LETTER",
      landscape: true,
    });
    expect(readNewPageChoice(NEW_DOCUMENT_CHOICE_KEY)).toMatchObject({
      template: "grid",
      size: "LETTER",
      landscape: true,
    });

    expect(takePendingNewDocumentSeed(docId)).toEqual({
      template: "grid",
      size: "LETTER",
      landscape: true,
      imageFile: null,
      imageFit: "cover",
    });
  });

  it("open/close toggles the dialog without creating", async () => {
    const onCreated = vi.fn();
    const { result } = renderHook(() => useNewDocument({ onCreated }));

    expect(result.current.isOpen).toBe(false);
    expect(result.current.dialog).toBeNull();

    act(() => {
      result.current.open({ course: "MATH 221" });
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.dialog).not.toBeNull();

    act(() => {
      result.current.close();
    });
    expect(result.current.isOpen).toBe(false);
    expect(onCreated).not.toHaveBeenCalled();
    expect(await listDocs()).toEqual([]);
  });
});
