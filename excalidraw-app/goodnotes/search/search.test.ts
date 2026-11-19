import { beforeEach, describe, expect, it } from "vitest";

import {
  createDoc,
  deleteDoc,
  getScene,
  listDocs,
  saveScene,
} from "../library";

import {
  ensureSearchIndex,
  forgetDocText,
  extractPageTexts,
  resetSearchIndexForTests,
  searchNotes,
  snippetAround,
} from "./index";

import type { DocScene } from "../types";

const pageFrame = (n: number, extra: Record<string, unknown> = {}): any => ({
  id: `frame-${n}`,
  type: "frame",
  name: `page:${n}`,
  isDeleted: false,
  version: 1,
  versionNonce: n,
  index: `a${n}`,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  ...extra,
});

const text = (id: string, value: string, frameId?: string): any => ({
  id,
  type: "text",
  text: value,
  frameId: frameId ?? null,
  isDeleted: false,
  version: 1,
  versionNonce: 1,
  index: `b${id}`,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
});

const sceneOf = (...elements: any[]): DocScene => ({
  elements,
  appState: {},
  files: {},
});

describe("extracting text from a scene", () => {
  it("attributes a text element to the page frame it sits in", () => {
    const pages = extractPageTexts(
      sceneOf(
        pageFrame(1),
        pageFrame(2),
        text("t1", "eigenvalues of a symmetric matrix", "frame-1"),
        text("t2", "Gram-Schmidt", "frame-2"),
      ),
    );
    expect(pages).toEqual([
      { page: 1, name: null, text: "eigenvalues of a symmetric matrix" },
      { page: 2, name: null, text: "Gram-Schmidt" },
    ]);
  });

  it("reads the text an imported PDF page stashed on its frame", () => {
    const pages = extractPageTexts(
      sceneOf(
        pageFrame(1, {
          customData: {
            goodnotesPdfImport: { text: "Lecture 3   Hilbert   spaces" },
          },
        }),
      ),
    );
    // whitespace from the PDF extractor is collapsed
    expect(pages[0].text).toBe("Lecture 3 Hilbert spaces");
  });

  it("reads a graph's alt text", () => {
    const pages = extractPageTexts(
      sceneOf(pageFrame(1), {
        id: "img",
        type: "image",
        frameId: "frame-1",
        isDeleted: false,
        version: 1,
        versionNonce: 1,
        index: "c1",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        customData: {
          goodnotes: { graph: { alt: "Graph of y = sin(x)" } },
        },
      } as any),
    );
    expect(pages[0].text).toBe("Graph of y = sin(x)");
  });

  it("files content outside any page frame under page 0", () => {
    const pages = extractPageTexts(sceneOf(text("t1", "loose note")));
    expect(pages).toEqual([{ page: 0, name: null, text: "loose note" }]);
  });

  it("skips deleted elements and pages with nothing readable", () => {
    const pages = extractPageTexts(
      sceneOf(
        pageFrame(1),
        pageFrame(2),
        { ...text("t1", "gone", "frame-1"), isDeleted: true },
        text("t2", "kept", "frame-2"),
      ),
    );
    expect(pages).toEqual([{ page: 2, name: null, text: "kept" }]);
  });

  it("returns nothing for a notebook of pure ink", () => {
    expect(
      extractPageTexts(
        sceneOf(pageFrame(1), {
          id: "ink",
          type: "freedraw",
          frameId: "frame-1",
          isDeleted: false,
          version: 1,
          versionNonce: 1,
          index: "d1",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
        } as any),
      ),
    ).toEqual([]);
  });
});

describe("snippets", () => {
  it("centres on the match and marks both elisions", () => {
    const body = `${"x".repeat(100)} eigenvalue ${"y".repeat(100)}`;
    const snippet = snippetAround(body, "eigenvalue", 10);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("eigenvalue");
  });

  it("falls back to the opening when the match is not literal", () => {
    expect(snippetAround("alpha beta gamma", "zzz", 100)).toBe(
      "alpha beta gamma",
    );
  });
});

describe("searching across notebooks", () => {
  beforeEach(async () => {
    resetSearchIndexForTests();
    for (const doc of await listDocs()) {
      await deleteDoc(doc.id);
    }
  });

  const seed = async (title: string, ...bodies: string[]) => {
    const doc = await createDoc({ title });
    await saveScene(
      doc.id,
      sceneOf(
        ...bodies.flatMap((body, i) => [
          pageFrame(i + 1),
          text(`${doc.id}-t${i}`, body, `frame-${i + 1}`),
        ]),
      ),
    );
    return doc;
  };

  it("finds the notebook a phrase was written in, and on which page", async () => {
    const linear = await seed(
      "Linear algebra",
      "orthogonal projections",
      "eigenvalues and eigenvectors",
    );
    await seed("Cooking", "how to poach an egg");

    await ensureSearchIndex(await listDocs());
    const hits = searchNotes("eigenvalues");

    expect(hits).toHaveLength(1);
    expect(hits[0].docId).toBe(linear.id);
    expect(hits[0].page).toBe(2);
    expect(hits[0].snippet).toContain("eigenvalues");
  });

  it("matches a prefix, so results appear while still typing", async () => {
    const doc = await seed("Linear algebra", "eigenvalues and eigenvectors");
    await ensureSearchIndex(await listDocs());
    expect(searchNotes("eigenv").map((h) => h.docId)).toEqual([doc.id]);
  });

  it("tolerates a typo in a long word", async () => {
    const doc = await seed("Linear algebra", "eigenvalues and eigenvectors");
    await ensureSearchIndex(await listDocs());
    expect(searchNotes("eigenvaules").map((h) => h.docId)).toEqual([doc.id]);
  });

  it("ignores a one-character query rather than matching everything", async () => {
    await seed("Linear algebra", "eigenvalues");
    await ensureSearchIndex(await listDocs());
    expect(searchNotes("e")).toEqual([]);
  });

  it("returns one hit per notebook, not one per page", async () => {
    const doc = await seed("Repetitive", "topology", "topology", "topology");
    await ensureSearchIndex(await listDocs());
    const hits = searchNotes("topology");
    expect(hits).toHaveLength(1);
    expect(hits[0].docId).toBe(doc.id);
  });

  it("drops a page's text when it is edited away", async () => {
    const doc = await seed("Draft", "provisional wording");
    await ensureSearchIndex(await listDocs());
    expect(searchNotes("provisional")).toHaveLength(1);

    await saveScene(
      doc.id,
      sceneOf(pageFrame(1), text("t-new", "final wording", "frame-1")),
    );
    await ensureSearchIndex(await listDocs());

    expect(searchNotes("provisional")).toEqual([]);
    expect(searchNotes("final")).toHaveLength(1);
  });

  it("backfills a notebook that was never indexed on save", async () => {
    const doc = await seed("Old notebook", "pre-existing content");
    // simulate a library that predates the search index: drop what the save
    // wrote, leaving only the scene behind
    await forgetDocText(doc.id);
    resetSearchIndexForTests();

    await ensureSearchIndex(await listDocs());
    expect(searchNotes("pre-existing")).toEqual([]);

    await ensureSearchIndex(await listDocs(), getScene);
    expect(searchNotes("pre-existing").map((h) => h.docId)).toEqual([doc.id]);
  });

  it("stops returning a deleted notebook", async () => {
    const doc = await seed("Temporary", "ephemeral content");
    await ensureSearchIndex(await listDocs());
    expect(searchNotes("ephemeral")).toHaveLength(1);

    await deleteDoc(doc.id);
    await ensureSearchIndex(await listDocs());

    expect(searchNotes("ephemeral")).toEqual([]);
  });
});
