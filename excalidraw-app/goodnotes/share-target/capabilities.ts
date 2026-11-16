/**
 * Honest capability detection for "open this PDF in the app" flows.
 *
 * ## The finding this module exists for
 *
 * **iOS and iPadOS cannot deliver a share to a web app.** Safari (and every
 * other iOS browser, since they all run WebKit) does not implement the Web
 * Share Target API: a PWA cannot appear in the iOS share sheet, installed or
 * not. There is no flag, no entitlement and no polyfill. Sharing *out* with
 * `navigator.share()` works fine there — it is only *receiving* that is
 * missing.
 *
 * Receiving shares works on **Chromium on Android and ChromeOS**, and only
 * **after the PWA has been installed** to the home screen / launcher: the
 * manifest's `share_target` is read at install time.
 *
 * So: never render "Share a PDF to this app" as available unless
 * {@link canReceiveShares} is true. On iPad — the main audience — the real
 * path is the file picker and drag-and-drop (the Files app, "Open in…" and
 * Split View drag all arrive as a plain `File` through `<input type="file">`
 * or a `drop` event), which {@link PdfDropZone} handles.
 *
 * ## Why user-agent sniffing
 *
 * There is no feature test for Web Share Target. Nothing is exposed to JS:
 * the browser reads the manifest at install time and the page never learns
 * the outcome. Sniffing is the only option; this module keeps it narrow
 * (opt-**in** for the platforms known to support it, never opt-out) so an
 * unknown browser is reported as unsupported and gets the fallback UI, which
 * always works.
 */

export interface ShareTargetCapabilities {
  /**
   * Can the OS share sheet hand a PDF to this app *right now*? True only on
   * an installed Chromium PWA on Android/ChromeOS.
   */
  canReceiveShares: boolean;
  /**
   * Would this browser support it once installed? Lets the UI say
   * "install the app to share PDFs straight from other apps" instead of
   * hiding the feature.
   */
  canReceiveSharesWhenInstalled: boolean;
  /** Running as an installed PWA (standalone display mode). */
  isInstalled: boolean;
  /** iOS or iPadOS — including an iPad reporting itself as a Mac. */
  isIos: boolean;
  /** Service workers available at all (needed for the POST handoff). */
  hasServiceWorker: boolean;
  /** `navigator.share()` is present — sharing *out* works. */
  canShareOut: boolean;
  /** `navigator.canShare({files})` — sharing a file out works. */
  canShareFilesOut: boolean;
  /** One short sentence explaining the verdict, fit for a tooltip. */
  reason: string;
}

const ua = (): string =>
  typeof navigator === "undefined" ? "" : navigator.userAgent || "";

/**
 * iPadOS 13+ reports a desktop Safari UA, so the touch-point count is the
 * usual tell: no Mac has a touchscreen.
 */
export const isIos = (): boolean => {
  if (typeof navigator === "undefined") {
    return false;
  }
  const agent = ua();
  if (/iPad|iPhone|iPod/.test(agent)) {
    return true;
  }
  return /Macintosh/.test(agent) && (navigator.maxTouchPoints ?? 0) > 1;
};

/** Any WebKit-only browser (every iOS browser, plus desktop Safari). */
export const isWebKitOnly = (): boolean => {
  const agent = ua();
  if (isIos()) {
    return true;
  }
  return /Safari/.test(agent) && !/Chrome|Chromium|Edg|OPR/.test(agent);
};

/** Launched from the home screen / launcher rather than a browser tab. */
export const isInstalledPwa = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  const standalone =
    typeof window.matchMedia === "function" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches);
  // iOS-only legacy flag; harmless elsewhere
  const iosStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return Boolean(standalone || iosStandalone);
};

/**
 * Platforms whose browser implements Web Share Target level 2 (files).
 * Chromium on Android and ChromeOS. Desktop Chrome on Windows/Linux/macOS
 * does not register PWAs in the OS share sheet for files, so it is excluded.
 */
const platformSupportsShareTarget = (): boolean => {
  const agent = ua();
  if (isIos() || isWebKitOnly()) {
    return false;
  }
  if (!/Chrome|Chromium|Edg|SamsungBrowser/.test(agent)) {
    return false;
  }
  if (/Firefox|FxiOS/.test(agent)) {
    return false;
  }
  return /Android|CrOS/.test(agent);
};

const hasServiceWorker = (): boolean =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator;

/** Full report. Cheap — call it in render if you like. */
export const getShareTargetCapabilities = (): ShareTargetCapabilities => {
  const ios = isIos();
  const installed = isInstalledPwa();
  const sw = hasServiceWorker();
  const platform = platformSupportsShareTarget();
  const canReceiveSharesWhenInstalled = platform && sw;
  const canReceive = canReceiveSharesWhenInstalled && installed;

  const canShareOut =
    typeof navigator !== "undefined" && typeof navigator.share === "function";
  let canShareFilesOut = false;
  try {
    canShareFilesOut =
      canShareOut &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({
        files: [
          new File([new Uint8Array([0])], "probe.pdf", {
            type: "application/pdf",
          }),
        ],
      });
  } catch {
    canShareFilesOut = false;
  }

  let reason: string;
  if (canReceive) {
    reason = "This device can share PDFs straight into the app.";
  } else if (canReceiveSharesWhenInstalled) {
    reason =
      "Install the app to your home screen to share PDFs into it from other apps.";
  } else if (ios) {
    reason =
      "iPhone and iPad cannot share files into a web app. Use Import PDF, or drag a PDF in from the Files app.";
  } else if (!sw) {
    reason =
      "This browser has no service worker support, so it cannot receive shared files. Use Import PDF instead.";
  } else {
    reason =
      "This browser cannot receive shared files. Use Import PDF, or drag a PDF onto the window.";
  }

  return {
    canReceiveShares: canReceive,
    canReceiveSharesWhenInstalled,
    isInstalled: installed,
    isIos: ios,
    hasServiceWorker: sw,
    canShareOut,
    canShareFilesOut,
    reason,
  };
};

/**
 * The one-liner most UI needs: may we advertise "share a PDF to this app"?
 *
 * ```tsx
 * {canReceiveShares() && <p>Tip: share a PDF to Notebook from any app.</p>}
 * ```
 */
export const canReceiveShares = (): boolean =>
  getShareTargetCapabilities().canReceiveShares;

/** Human-readable explanation of the current device's share support. */
export const describeShareSupport = (): string =>
  getShareTargetCapabilities().reason;
