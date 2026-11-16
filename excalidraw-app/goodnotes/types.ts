/**
 * Shared contract for the GoodNotes-style layer built on top of Excalidraw.
 *
 * OWNERSHIP RULE: this file is owned by the integrator. Feature modules must
 * import from here and MUST NOT edit it. If you need a new shared type,
 * declare it locally in your own module and report it instead.
 */

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
} from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

/** Page geometry presets, in CSS px at 96dpi. */
export const PAGE_SIZES = {
  LETTER: { width: 816, height: 1056 },
  A4: { width: 794, height: 1123 },
  LEGAL: { width: 816, height: 1344 },
} as const;

export type PageSizeName = keyof typeof PAGE_SIZES;

/** Vertical gap between stacked pages on the canvas. */
export const PAGE_GAP = 48;

/** Identifies a frame that acts as a document page. */
export const PAGE_FRAME_PREFIX = "page:";

export type PaperTemplateId =
  | "blank"
  | "lined"
  | "grid"
  | "dotted"
  | "cornell"
  | "staff";

export interface PaperTemplate {
  id: PaperTemplateId;
  label: string;
  /** Draw one page's background. ctx is already translated to page origin. */
  render: (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    opts: { theme: "light" | "dark" },
  ) => void;
}

/** How a page's background picture is fitted to the page. */
export type PageImageFit = "cover" | "contain" | "stretch";

/**
 * A picture used as a page's background. Orthogonal to the ruling: a scan
 * can still have lines drawn over it, so this is a sibling of the template
 * rather than a seventh PaperTemplateId.
 */
export interface PageImageBackground {
  fileId: string;
  mimeType?: string;
  fit?: PageImageFit;
  opacity?: number;
  name?: string;
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface Page {
  /** The frame element backing this page. */
  frame: ExcalidrawFrameElement;
  index: number;
  template: PaperTemplateId;
  /** Background picture, if this page has one. */
  image?: PageImageBackground;
}

/** Metadata row shown on the home shelf. Scene data is stored separately. */
export interface DocMeta {
  id: string;
  title: string;
  course: string | null;
  dueDate: number | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
  /** data: URL PNG thumbnail of page 1. */
  thumbnail: string | null;
  pageCount: number;
  defaultTemplate: PaperTemplateId;
  defaultPageSize: PageSizeName;
  defaultLandscape?: boolean;
  defaultImageFit?: PageImageFit;
}

/** Full persisted scene for one document. */
export interface DocScene {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

export interface PenPreset {
  id: string;
  label: string;
  tool: "freedraw" | "highlighter" | "eraser";
  color: string;
  width: number;
  opacity: number;
}

export type SortKey = "dueDate" | "updatedAt" | "title" | "course";
