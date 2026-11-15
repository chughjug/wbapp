/**
 * Fuzzy select — copy to the system clipboard.
 *
 * Writes the rasterized selection as an `image/png` `ClipboardItem` so it can
 * be pasted straight into another app (or back into Excalidraw).
 *
 * The async clipboard API fails in several distinct, *non-obvious* ways, and
 * every one of them is reported here with a message a student can act on
 * rather than a silent no-op:
 *
 *  - the page is not a secure context (plain `http://` on a non-localhost
 *    host) — the API is simply absent
 *  - the browser has no `ClipboardItem` (older Firefox)
 *  - the user or an enterprise policy denied the `clipboard-write`
 *    permission
 *  - the document was not focused when the write was attempted (Chrome
 *    throws `NotAllowedError: Document is not focused`)
 *
 * Callers should surface {@link ClipboardCopyError.message} verbatim and may
 * branch on {@link ClipboardCopyError.reason} to offer a fallback (e.g. the
 * module's own {@link downloadRasterAsPng}).
 */

export type ClipboardCopyFailureReason =
  | "insecure-context"
  | "unsupported"
  | "denied"
  | "not-focused"
  | "failed";

export class ClipboardCopyError extends Error {
  public readonly reason: ClipboardCopyFailureReason;

  constructor(
    reason: ClipboardCopyFailureReason,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "ClipboardCopyError";
    this.reason = reason;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Whether image copy can work at all in this document, without attempting
 * anything. Use it to disable or relabel the Copy button up front.
 */
export const canCopyImageToClipboard = (): boolean =>
  typeof window !== "undefined" &&
  window.isSecureContext === true &&
  typeof navigator !== "undefined" &&
  !!navigator.clipboard &&
  typeof navigator.clipboard.write === "function" &&
  typeof window.ClipboardItem === "function";

/**
 * Copies a PNG blob to the system clipboard.
 *
 * @throws {ClipboardCopyError} always with an actionable message.
 */
export const copyPngToClipboard = async (blob: Blob): Promise<void> => {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    throw new ClipboardCopyError(
      "unsupported",
      "Copying is only available in a browser.",
    );
  }

  if (!window.isSecureContext) {
    throw new ClipboardCopyError(
      "insecure-context",
      "Copying images needs a secure connection. Open this app over https (or on localhost) and try again.",
    );
  }

  if (
    !navigator.clipboard ||
    typeof navigator.clipboard.write !== "function" ||
    typeof window.ClipboardItem !== "function"
  ) {
    throw new ClipboardCopyError(
      "unsupported",
      "This browser can't copy images to the clipboard. Use Duplicate instead, or save the selection as a PNG.",
    );
  }

  try {
    await navigator.clipboard.write([
      new window.ClipboardItem({ "image/png": blob }),
    ]);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : String(error);

    if (/not focused/i.test(message)) {
      throw new ClipboardCopyError(
        "not-focused",
        "The page lost focus before the copy finished. Click the page, then press Copy again.",
        error,
      );
    }

    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new ClipboardCopyError(
        "denied",
        "Clipboard access was blocked. Allow clipboard permission for this site in your browser settings, then try again.",
        error,
      );
    }

    throw new ClipboardCopyError(
      "failed",
      `The selection couldn't be copied: ${message}`,
      error,
    );
  }
};

/**
 * Fallback for when the clipboard is unavailable: download the raster as a
 * PNG file. Never throws for permission reasons.
 */
export const downloadRasterAsPng = (
  blob: Blob,
  fileName = "selection.png",
): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.endsWith(".png") ? fileName : `${fileName}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
