/**
 * "How big will this be?", answered before the student waits for it.
 *
 * The dialog already rasterises every selected page as a small preview
 * thumbnail, and measures each thumbnail's encoded PNG size. That gives a
 * free per-page sample of (scale, bytes), which is extrapolated to the real
 * export scale. No extra rendering is done just to guess the size.
 *
 * The extrapolation is a power law: PNG bytes grow with pixel count for
 * dense content (exponent 2) and much slower for sparse ink on plain paper
 * (exponent ~1), because the paper compresses away. {@link SIZE_EXPONENT} is
 * the fitted middle; measured against real exports of a 4-page notebook it
 * lands within roughly ±40%, which is why every estimate is rendered with a
 * "~" and never presented as a fact.
 */

import type { ExportFormat } from "./presets";

/** Fitted exponent for "PNG bytes vs. raster scale" (see the file header). */
export const SIZE_EXPONENT = 1.45;

/** jsPDF container overhead: xref table, fonts, page objects. */
export const PDF_OVERHEAD_BYTES = 2_200;

/** jsPDF re-wraps each page PNG; the stream is a little larger than the PNG. */
export const PDF_IMAGE_OVERHEAD_RATIO = 1.03;

export interface PageSizeSample {
  /** 1-based page number. */
  pageNumber: number;
  /** Scale the sample was rendered at. */
  scale: number;
  /** Encoded PNG size of the sample, in bytes. */
  bytes: number;
}

export interface EstimateOptions {
  /** Measured thumbnails, however many are ready so far. */
  samples: readonly PageSizeSample[];
  /** The pages that will actually be exported (1-based). */
  pages: readonly number[];
  /** The scale the export will run at. */
  scale: number;
  format: ExportFormat;
}

/** Bytes one page is expected to take at `scale`, from one sample. */
const projectSample = (sample: PageSizeSample, scale: number): number =>
  sample.bytes * (scale / sample.scale) ** SIZE_EXPONENT;

/**
 * Estimated total bytes of the export, or `null` when nothing has been
 * measured yet (the UI then says "calculating…" rather than lying).
 */
export const estimateExportBytes = ({
  samples,
  pages,
  scale,
  format,
}: EstimateOptions): number | null => {
  if (samples.length === 0 || pages.length === 0) {
    return null;
  }

  const byPage = new Map(samples.map((s) => [s.pageNumber, s]));
  const mean =
    samples.reduce((sum, s) => sum + projectSample(s, scale), 0) /
    samples.length;

  let total = 0;
  for (const page of pages) {
    const sample = byPage.get(page);
    total += sample ? projectSample(sample, scale) : mean;
  }

  if (format === "pdf") {
    return Math.round(total * PDF_IMAGE_OVERHEAD_RATIO + PDF_OVERHEAD_BYTES);
  }
  return Math.round(total);
};

/** `1536` -> `"1.5 kB"`. Decimal units, the ones file managers show. */
export const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes < 1000) {
    return `${Math.round(bytes)} B`;
  }
  const units = ["kB", "MB", "GB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${
    units[unit]
  }`;
};

/** How long the export is likely to take, in seconds, for honest copy. */
export const estimateSeconds = (pageCount: number, scale: number): number =>
  // measured: ~0.25s per page at 1x on a laptop, quadratic in scale
  Math.max(1, Math.round(pageCount * 0.25 * scale * scale));

/** `"about 20 seconds"` / `"about 2 minutes"`. */
export const formatDuration = (seconds: number): string => {
  if (seconds < 60) {
    return `about ${Math.max(1, Math.round(seconds / 5) * 5)} seconds`;
  }
  const minutes = Math.round(seconds / 60);
  return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
};
