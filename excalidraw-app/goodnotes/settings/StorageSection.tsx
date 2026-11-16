/**
 * <StorageSection /> — how much space notebooks take, and the backup you can
 * actually restore.
 *
 * Three jobs:
 *  1. report `navigator.storage.estimate()` and a document count, honestly
 *     labelled (the estimate is per-origin and deliberately rounded by the
 *     browser);
 *  2. download one JSON bundle holding every document's metadata and scene;
 *  3. restore one, behind a confirmation that names what will happen.
 *
 * Accessibility notes that are load-bearing rather than decorative:
 *  - the progress line is an `aria-live="polite"` region whose *text* changes
 *    ("Backing up 3 of 7…", "Backup ready — 12.4 MB"), because a `<progress>`
 *    element's value changing is not announced on its own;
 *  - the live region is rendered unconditionally and only its text changes, so
 *    screen readers have it in the accessibility tree before the first update
 *    (a region that appears at the same moment its text does is frequently
 *    missed);
 *  - restore is destructive, so the confirmation is a focusable panel with an
 *    explicit "Replace" / "Merge" radio group and a spelled-out consequence,
 *    not a `window.confirm`.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { subscribe } from "../library";

import {
  downloadBackup,
  exportBackup,
  formatBytes,
  getStorageReport,
  importBackup,
  readBundleFile,
} from "./backup";

import type {
  BackupBundle,
  BackupProgress,
  RestoreMode,
  StorageReport,
} from "./backup";

export interface StorageSectionProps {
  /** Called after a successful restore, so the host can reload the library. */
  onRestored?: () => void;
  headingId: string;
}

type Busy = "idle" | "exporting" | "importing";

const initialProgress: BackupProgress = {
  phase: "idle",
  completed: 0,
  total: 0,
};

export const StorageSection = ({
  onRestored,
  headingId,
}: StorageSectionProps) => {
  const idPrefix = useId();
  const [report, setReport] = useState<StorageReport | null>(null);
  const [busy, setBusy] = useState<Busy>("idle");
  const [progress, setProgress] = useState<BackupProgress>(initialProgress);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    bundle: BackupBundle;
    fileName: string;
  } | null>(null);
  const [mode, setMode] = useState<RestoreMode>("merge");
  const [withPrefs, setWithPrefs] = useState(true);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const confirmRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    void getStorageReport().then((next) => {
      if (mountedRef.current) {
        setReport(next);
      }
    });
  }, []);

  useEffect(() => {
    refresh();
    // the library changing under us (a save elsewhere) makes the count stale
    return subscribe(refresh);
  }, [refresh]);

  // move focus to the confirmation as soon as it appears: it is the only
  // thing on screen that matters at that moment
  useEffect(() => {
    if (pending) {
      confirmRef.current?.focus();
    }
  }, [pending]);

  const onProgress = useCallback((next: BackupProgress) => {
    if (!mountedRef.current) {
      return;
    }
    setProgress(next);
    if (next.phase === "counting") {
      setStatus("Looking at your notebooks…");
    } else if (next.phase === "reading") {
      setStatus(
        next.total === 0
          ? "No notebooks to back up."
          : `Backing up notebook ${Math.min(
              next.completed + 1,
              next.total,
            )} of ${next.total}${next.current ? `: ${next.current}` : ""}…`,
      );
    } else if (next.phase === "writing") {
      setStatus(
        `Restoring notebook ${Math.min(next.completed + 1, next.total)} of ${
          next.total
        }${next.current ? `: ${next.current}` : ""}…`,
      );
    }
  }, []);

  const handleExport = useCallback(async () => {
    setBusy("exporting");
    setError(null);
    setStatus("Starting backup…");
    try {
      const result = await exportBackup(onProgress);
      downloadBackup(result.blob, result.fileName);
      setStatus(
        `Backup ready: ${result.fileName} — ${
          result.documentCount
        } notebook${result.documentCount === 1 ? "" : "s"}, ${formatBytes(
          result.bytes,
        )}. Check your downloads.`,
      );
      setProgress((current) => ({ ...current, phase: "done" }));
    } catch (caught: any) {
      const message = `The backup failed: ${caught?.message ?? caught}`;
      setError(message);
      setStatus(message);
      setProgress({ phase: "error", completed: 0, total: 0, message });
    } finally {
      if (mountedRef.current) {
        setBusy("idle");
        refresh();
      }
    }
  }, [onProgress, refresh]);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) {
        return;
      }
      setError(null);
      setStatus(`Reading ${file.name}…`);
      try {
        const bundle = await readBundleFile(file);
        setPending({ bundle, fileName: file.name });
        setStatus(
          `${file.name} holds ${bundle.documents.length} notebook${
            bundle.documents.length === 1 ? "" : "s"
          }, backed up on ${new Date(bundle.createdAt).toLocaleString()}. Choose how to restore it.`,
        );
      } catch (caught: any) {
        const message = caught?.message ?? String(caught);
        setError(message);
        setStatus(message);
      }
    },
    [],
  );

  const handleRestore = useCallback(async () => {
    if (!pending) {
      return;
    }
    const { bundle, fileName } = pending;
    setPending(null);
    setBusy("importing");
    setError(null);
    setStatus("Restoring…");
    try {
      const result = await importBackup(bundle, {
        mode,
        preferences: withPrefs,
        onProgress,
      });
      const warningText =
        result.warnings.length > 0
          ? ` ${result.warnings.length} item(s) had problems: ${result.warnings
              .slice(0, 3)
              .join(" ")}`
          : "";
      setStatus(
        `Restored ${result.documentsRestored} notebook${
          result.documentsRestored === 1 ? "" : "s"
        } (${result.scenesRestored} with pages) from ${fileName}.${warningText} Reload the app to see them.`,
      );
      setProgress((current) => ({ ...current, phase: "done" }));
      onRestored?.();
    } catch (caught: any) {
      const message = `The restore failed: ${caught?.message ?? caught}`;
      setError(message);
      setStatus(message);
      setProgress({ phase: "error", completed: 0, total: 0, message });
    } finally {
      if (mountedRef.current) {
        setBusy("idle");
        refresh();
      }
    }
  }, [pending, mode, withPrefs, onProgress, onRestored, refresh]);

  const pct =
    progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : null;

  return (
    <section
      className="gn-settings-section gn-settings-storage"
      id="gn-settings-storage"
      aria-labelledby={headingId}
    >
      <h2 className="gn-settings-section__title" id={headingId}>
        Storage &amp; backup
      </h2>
      <p className="gn-settings-section__blurb">
        Notebooks live in this browser on this device. Nothing is uploaded
        anywhere, which also means clearing site data deletes them — so keep a
        backup.
      </p>

      <dl className="gn-settings-storage__figures">
        <div>
          <dt>Notebooks</dt>
          <dd>{report ? report.documentCount : "—"}</dd>
        </div>
        <div>
          <dt>Space used</dt>
          <dd>
            {report?.usage != null ? formatBytes(report.usage) : "Unknown"}
          </dd>
        </div>
        <div>
          <dt>Space available</dt>
          <dd>
            {report?.quota != null ? formatBytes(report.quota) : "Unknown"}
          </dd>
        </div>
      </dl>

      {report?.ratio != null && (
        <>
          <div
            className="gn-settings-storage__bar"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(report.ratio * 100)}
            aria-valuetext={`${formatBytes(
              report.usage ?? 0,
            )} of ${formatBytes(report.quota ?? 0)} used`}
            aria-label="Storage used by this app"
          >
            <span
              style={{ width: `${Math.min(100, report.ratio * 100).toFixed(2)}%` }}
            />
          </div>
          <p className="gn-settings-field__hint">
            This figure covers everything this site stores in your browser, not
            only notebooks, and browsers round it on purpose.
            {report.persisted === false
              ? " Storage here is not marked persistent, so the browser may evict it when space runs low."
              : report.persisted === true
              ? " Storage here is marked persistent."
              : ""}
          </p>
        </>
      )}
      {report && !report.supported && (
        <p className="gn-settings-field__hint">
          This browser does not report how much space it is using.
        </p>
      )}

      <h3 className="gn-settings-section__sub">Back up</h3>
      <p className="gn-settings-field__hint">
        One file with every notebook&rsquo;s details and pages, including
        imported images and PDFs. Large libraries make a large file — the
        images are stored as text, so expect it to be bigger than the figure
        above.
      </p>
      <div className="gn-settings-actions">
        <button
          type="button"
          className="gn-settings-button is-primary"
          onClick={() => void handleExport()}
          disabled={busy !== "idle"}
        >
          {busy === "exporting"
            ? "Backing up…"
            : "Download a backup of everything"}
        </button>
      </div>

      <h3 className="gn-settings-section__sub">Restore</h3>
      <p className="gn-settings-field__hint">
        Pick a <code>notebook-backup-….json</code> file. You will be asked to
        confirm before anything changes.
      </p>
      <div className="gn-settings-actions">
        <button
          type="button"
          className="gn-settings-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy !== "idle"}
        >
          Choose a backup file…
        </button>
        <input
          ref={fileInputRef}
          id={`${idPrefix}-file`}
          className="gn-settings-sr"
          type="file"
          accept="application/json,.json"
          aria-label="Backup file to restore"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // allow re-picking the same file after a cancelled restore
            event.target.value = "";
            void handleFile(file);
          }}
        />
      </div>

      {pending && (
        <div
          className="gn-settings-confirm"
          ref={confirmRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={`${idPrefix}-confirm-title`}
        >
          <p id={`${idPrefix}-confirm-title`}>
            <strong>Restore {pending.bundle.documents.length} notebook(s)</strong>{" "}
            from {pending.fileName}?
          </p>
          <fieldset
            style={{ border: 0, margin: 0, padding: 0 }}
            aria-label="What to do with the notebooks already here"
          >
            <label className="gn-settings-radio" htmlFor={`${idPrefix}-merge`}>
              <input
                type="radio"
                id={`${idPrefix}-merge`}
                name={`${idPrefix}-mode`}
                checked={mode === "merge"}
                onChange={() => setMode("merge")}
              />
              <div>
                Add to what is here
                <span>
                  Notebooks already on this device are kept. A notebook in the
                  backup with the same id overwrites the one here.
                </span>
              </div>
            </label>
            <label className="gn-settings-radio" htmlFor={`${idPrefix}-replace`}>
              <input
                type="radio"
                id={`${idPrefix}-replace`}
                name={`${idPrefix}-mode`}
                checked={mode === "replace"}
                onChange={() => setMode("replace")}
              />
              <div>
                Replace everything
                <span>
                  <strong>
                    Deletes all {report?.documentCount ?? 0} notebook(s)
                  </strong>{" "}
                  currently on this device first, then restores the backup
                  exactly. This cannot be undone.
                </span>
              </div>
            </label>
          </fieldset>
          <label className="gn-settings-radio" htmlFor={`${idPrefix}-prefs`}>
            <input
              type="checkbox"
              id={`${idPrefix}-prefs`}
              checked={withPrefs}
              onChange={(event) => setWithPrefs(event.target.checked)}
            />
            <div>
              Also restore settings
              <span>Pen &amp; touch, theme, view mode, pens, default paper.</span>
            </div>
          </label>
          <div className="gn-settings-actions">
            <button
              type="button"
              className={`gn-settings-button ${
                mode === "replace" ? "is-danger" : "is-primary"
              }`}
              onClick={() => void handleRestore()}
            >
              {mode === "replace"
                ? "Delete everything and restore"
                : "Restore these notebooks"}
            </button>
            <button
              type="button"
              className="gn-settings-button"
              onClick={() => {
                setPending(null);
                setStatus("Restore cancelled. Nothing was changed.");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Rendered unconditionally so assistive tech has the region before the
          first message lands. */}
      <div
        className={`gn-settings-progress${
          error ? " is-error" : progress.phase === "done" ? " is-done" : ""
        }`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        hidden={!status}
      >
        {status}
        {busy !== "idle" && pct !== null && (
          <progress
            max={100}
            value={pct}
            aria-label={
              busy === "exporting" ? "Backup progress" : "Restore progress"
            }
          />
        )}
      </div>
    </section>
  );
};
