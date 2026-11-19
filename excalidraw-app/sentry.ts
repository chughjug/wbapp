/**
 * Optional error reporting.
 *
 * Upstream Excalidraw hardcodes its own Sentry DSN here and turns reporting
 * on for any hostname containing "excalidraw.com", "staging.excalidraw.com"
 * or — importantly for this fork — "vercel.app". A fork deployed to Vercel
 * therefore shipped its users' errors, console messages and URLs to a Sentry
 * project its owner does not control and cannot read.
 *
 * So reporting is off unless you opt in with your OWN DSN:
 *
 *   VITE_APP_SENTRY_DSN=https://…@…ingest.sentry.io/…
 *
 * With no DSN set, @sentry/browser is never imported, which also keeps it
 * out of the bundle. `VITE_APP_DISABLE_SENTRY=true` still forces it off.
 */

import { getFeatureFlag } from "@excalidraw/common";

// type-only: erased at build time, so it does not pull @sentry/browser in
import type * as SentryTypes from "@sentry/browser";

const DSN = import.meta.env.VITE_APP_SENTRY_DSN;
const DISABLED = import.meta.env.VITE_APP_DISABLE_SENTRY === "true";

if (DSN && !DISABLED && typeof window !== "undefined") {
  void (async () => {
    const [Sentry, { default: callsites }] = await Promise.all([
      import("@sentry/browser"),
      import("callsites"),
    ]);

    Sentry.init({
      dsn: DSN,
      environment: import.meta.env.VITE_APP_SENTRY_ENVIRONMENT || undefined,
      release: import.meta.env.VITE_APP_GIT_SHA,
      ignoreErrors: [
        "undefined is not an object (evaluating 'window.__pad.performLoop')", // Only happens on Safari, but spams our servers. Doesn't break anything
        "InvalidStateError: Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.", // Not much we can do about the IndexedDB closing error
        /(Failed to fetch|(fetch|loading) dynamically imported module)/i, // This is happening when a service worker tries to load an old asset
        /QuotaExceededError: (The quota has been exceeded|.*setItem.*Storage)/i, // localStorage quota exceeded
        "Internal error opening backing store for indexedDB.open", // Private mode and disabled indexedDB
      ],
      integrations: [
        Sentry.captureConsoleIntegration({
          levels: ["error"],
        }),
        Sentry.featureFlagsIntegration(),
      ],
      beforeSend(event) {
        if (event.request?.url) {
          event.request.url = event.request.url.replace(/#.*$/, "");
        }

        if (!event.exception) {
          event.exception = {
            values: [
              {
                type: "ConsoleError",
                value: event.message ?? "Unknown error",
                stacktrace: {
                  frames: callsites()
                    .slice(1)
                    .filter(
                      (frame) =>
                        frame.getFileName() &&
                        !frame.getFileName()?.includes("@sentry_browser.js"),
                    )
                    .map((frame) => ({
                      filename: frame.getFileName() ?? undefined,
                      function: frame.getFunctionName() ?? undefined,
                      in_app: !(
                        frame.getFileName()?.includes("node_modules") ?? false
                      ),
                      lineno: frame.getLineNumber() ?? undefined,
                      colno: frame.getColumnNumber() ?? undefined,
                    })),
                },
                mechanism: {
                  type: "instrument",
                  handled: true,
                  data: {
                    function: "console.error",
                    handler: "Sentry.beforeSend",
                  },
                },
              },
            ],
          };
        }

        return event;
      },
    });

    const flagsIntegration =
      Sentry.getClient()?.getIntegrationByName<SentryTypes.FeatureFlagsIntegration>(
        "FeatureFlags",
      );
    if (flagsIntegration) {
      flagsIntegration.addFeatureFlag(
        "COMPLEX_BINDINGS",
        getFeatureFlag("COMPLEX_BINDINGS"),
      );
    }
  })();
}
