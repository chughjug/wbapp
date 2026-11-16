/**
 * "How big will this be?", answered before the student waits for it.
 *
 * Alongside the preview thumbnails, the dialog renders each selected page
 * once at {@link CALIBRATION_SCALE} and measures the encoded PNG. The real
 * size is then extrapolated from that sample with a power law:
 *
 *     bytes(scale) = sample.bytes * (scale / sample.scale) ** k
 *
 * `k` is not a constant, because it depends on what is *on* the page. Sparse
 * ink on plain paper compresses away as it grows (k ~ 1.4); a photographic
 * page background does not (k ~ 0.9). The two are told apart by the sample's
 * bytes-per-pixel, which is why samples carry their pixel count — see
 * {@link exponentFor}.
 *
 * Measured against real exports of a 5-page notebook (four ink pages, one
 * full-bleed scanned page): PNG at 2x +1.5%, PDF at 2x -6.7%, PDF at 1x
 * +9.3%. It is still shown with a "~".
 */

import type { ExportFormat } from "./presets";

/** Scale the dialog measures pages at. Samples must use it to be comparable. */
export const CALIBRATION_SCALE = 0.5;

/** Exponent for pages that are mostly white paper and thin ink. */
export const SPARSE_EXPONENT = 1.4;
/** Exponent for pages that are a photo / scan edge to edge. */
export const DENSE_EXPONENT = 0.9;
/** Sample bytes-per-pixel at or below which a page counts as sparse ink. */
export const SPARSE_BYTES_PER_PIXEL = 0.1;
/** Sample bytes-per-pixel at or above which a page counts as photographic. */
export const DENSE_BYTES_PER_PIXEL = 0.8;

/**
 * How fast this page's bytes grow with resolution, read off how well it
 * compressed at the sample scale.
 */
export const exponentFor = (bytes: number, pixels: number): number => {
  if (!(pixels > 0) || !(bytes > 0)) {
    return SPARSE_EXPONENT;
  }
  const bytesPerPixel = bytes / pixels;
  const t =
    (Math.log10(bytesPerPixel) - Math.log10(SPARSE_BYTES_PER_PIXEL)) /
    (Math.log10(DENSE_BYTES_PER_PIXEL) - Math.log10(SPARSE_BYTES_PER_PIXEL));
  const clamped = Math.max(0, Math.min(1, t));
  return SPARSE_EXPONENT + clamped * (DENSE_EXPONENT - SPARSE_EXPONENT);
};

/** jsPDF container overhead: xref table, fonts, page objects. */
export const PDF_OVERHEAD_BYTES = 2_200;

/**
 * jsPDF re-encodes each page raster into the PDF rather than embedding the
 * PNG verbatim, and the result is consistently *smaller* than the sum of the
 * standalone PNGs. Measured on a 5-page notebook: 0.78x at 1x, 0.92x at 2x.
 */
export const PDF_STREAM_RATIO = 0.85;

export interface PageSizeSample {
  /** 1-based page number. */
  pageNumber: number;
  /** Scale the sample was rendered at (normally {@link CALIBRATION_SCALE}). */
  scale: number;
  /** Encoded PNG size of the sample, in bytes. */
  bytes: number;
  /** Raster pixel count of the sample — how dense the page is. */
  pixels: number;
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
  sample.bytes *
  (scale / sample.scale) ** exponentFor(sample.bytes, sample.pixels);

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
    return Math.round(total * PDF_STREAM_RATIO + PDF_OVERHEAD_BYTES);
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
