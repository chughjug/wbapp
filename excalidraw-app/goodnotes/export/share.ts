/**
 * System share sheet, with an honest download fallback.
 *
 * On iOS/iPadOS `navigator.share({ files })` hands the PDF straight to the
 * OS share sheet (Mail, Messages, Canvas, Google Classroom, Files…), which is
 * what a student on a tablet actually wants. It is *not* the same thing as a
 * Web Share **Target**, which Safari does not implement. Everything here is
 * feature-detected at call time: a browser without it just downloads.
 */

/** `navigator.share` with a `files` payload, feature-detected. */
interface FileSharePayload {
  files?: File[];
  title?: string;
  text?: string;
}

interface FileShareNavigator {
  canShare?: (data?: FileSharePayload) => boolean;
  share?: (data: FileSharePayload) => Promise<void>;
}

const getNav = (): FileShareNavigator | null =>
  typeof navigator === "undefined"
    ? null
    : (navigator as unknown as FileShareNavigator);

/**
 * True when this browser can share *these* files.
 *
 * `navigator.canShare({ files })` is per-payload: Safari rejects file types
 * and counts it won't take, so the check has to carry the real files.
 */
export const canShareFiles = (files: readonly File[]): boolean => {
  const nav = getNav();
  if (
    !nav ||
    typeof nav.share !== "function" ||
    typeof nav.canShare !== "function"
  ) {
    return false;
  }
  if (files.length === 0) {
    return false;
  }
  try {
    return nav.canShare({ files: [...files] });
  } catch {
    return false;
  }
};

/**
 * True when file sharing exists at all, without a payload — used only to
 * decide whether to *offer* "Share" as a delivery, never to promise it.
 */
export const supportsFileShare = (): boolean => {
  const nav = getNav();
  return (
    !!nav &&
    typeof nav.share === "function" &&
    typeof nav.canShare === "function"
  );
};

export type ShareOutcome =
  /** Handed to the OS share sheet. */
  | "shared"
  /** The share sheet opened and the user dismissed it. Nothing downloaded. */
  | "cancelled"
  /** No share sheet (or it failed) — the files were downloaded instead. */
  | "downloaded";

export interface ShareFilesOptions {
  files: readonly File[];
  title?: string;
  text?: string;
  /** Called for each file when falling back to a download. */
  download: (file: File) => void | Promise<void>;
}

/**
 * Shares via the OS sheet when possible, otherwise downloads.
 *
 * A user dismissing the share sheet (`AbortError`) is *not* an error and
 * does not trigger a download — they already said no.
 */
export const shareOrDownloadFiles = async ({
  files,
  title,
  text,
  download,
}: ShareFilesOptions): Promise<ShareOutcome> => {
  const nav = getNav();
  if (nav && canShareFiles(files)) {
    try {
      await nav.share!({ files: [...files], title, text });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
      // NotAllowedError (no user gesture), DataError, … — fall through to a
      // download rather than leaving the student with nothing.
    }
  }
  for (const file of files) {
    await download(file);
  }
  return "downloaded";
};
