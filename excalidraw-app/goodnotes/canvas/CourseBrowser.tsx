/**
 * The per-course browser: pick a course, then Assignments / Files / My
 * notebooks.
 *
 * It is a panel, not a modal — mount it on a route or in a sidebar. The only
 * modal in this module is the connect screen, which this will open for you
 * (or delegate to the host via `onConnect`) when there is no token yet.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";

import { AssignmentList } from "./AssignmentList";
import { CanvasProgress, describeImportPhase } from "./CanvasProgress";
import { CanvasTabs, tabId, tabPanelId } from "./CanvasTabs";
import { FileList } from "./FileList";
import { FilePreviewPane } from "./FilePreviewPane";
import { NotebookList } from "./NotebookList";
import { canvasFileName, importCanvasFile } from "./files";
import { describeCanvasError, needsReconnect } from "./errors";
import {
  CanvasDownloadError,
  canvasCourseLabel,
  createDocumentForAssignment,
} from "./sync";
import { useCanvasConnect } from "./useCanvasConnect";
import { useCanvasConnection } from "./useCanvasConnection";
import {
  findCourse,
  useCanvasCourses,
  useCourseAssignments,
  useCourseFiles,
  useCourseNotebooks,
} from "./useCanvasData";

import "./canvas.scss";

import type { CanvasTabSpec } from "./CanvasTabs";
import type { CourseFileRow } from "./useCanvasData";
import type { AssignmentRow } from "./sync";
import type { DocMeta } from "../types";

export type CourseBrowserTab = "assignments" | "files" | "notebooks";

export interface CourseBrowserProps {
  /** Open a notebook in the editor. */
  onOpenDocument?: (doc: DocMeta) => void;
  /**
   * Open your own connect screen. Omit it and this component opens the
   * built-in {@link CanvasConnectDialog} itself.
   */
  onConnect?: () => void;
  theme?: "light" | "dark";
  initialCourseId?: string | null;
  initialTab?: CourseBrowserTab;
  onCourseChange?: (courseId: string | null) => void;
  /** Test seam: skip the pdf.js first-page render in the preview pane. */
  disablePreview?: boolean;
}

const ID_PREFIX = "gn-canvas-browser";

export const CourseBrowser: React.FC<CourseBrowserProps> = ({
  onOpenDocument,
  onConnect,
  theme,
  initialCourseId = null,
  initialTab = "assignments",
  onCourseChange,
  disablePreview = false,
}) => {
  const { connection, isConnected } = useCanvasConnection();
  const fallbackConnect = useCanvasConnect({ theme });
  const openConnect = onConnect ?? fallbackConnect.open;

  const [tab, setTab] = useState<CourseBrowserTab>(initialTab);
  const [courseId, setCourseId] = useState<string | null>(initialCourseId);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [busyAssignmentId, setBusyAssignmentId] = useState<string | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [importing, setImporting] = useState<{
    fileId: string;
    phase: string;
    done: number;
    total: number;
  } | null>(null);
  const [importStatus, setImportStatus] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{
    message: string;
    url?: string;
  } | null>(null);
  const [localVersion, setLocalVersion] = useState(0);

  const courses = useCanvasCourses();
  const course = findCourse(courses.data, courseId);

  // default to the first course once they arrive
  useEffect(() => {
    if (!courseId && courses.data.length > 0) {
      setCourseId(courses.data[0].id);
    }
  }, [courses.data, courseId]);

  useEffect(() => {
    onCourseChange?.(courseId);
  }, [courseId, onCourseChange]);

  const assignments = useCourseAssignments(courseId, course);
  const files = useCourseFiles(courseId);
  const label = course ? canvasCourseLabel(course) : "";
  const notebooks = useCourseNotebooks(course, localVersion);

  const selectedRow = useMemo(
    () => files.data.find((row) => row.file.id === selectedFileId) ?? null,
    [files.data, selectedFileId],
  );

  // reset per-course UI state
  useEffect(() => {
    setSelectedFileId(null);
    setAssignmentError(null);
    setImportError(null);
    setBlocked(null);
    setImportStatus("");
  }, [courseId]);

  const openDocument = useCallback(
    (doc: DocMeta) => onOpenDocument?.(doc),
    [onOpenDocument],
  );

  // --- create notes for an assignment --------------------------------------
  const onCreateNotes = useCallback(
    async (row: AssignmentRow) => {
      setAssignmentError(null);
      setBusyAssignmentId(row.assignment.id);
      try {
        const doc = await createDocumentForAssignment(row);
        setLocalVersion((v) => v + 1);
        assignments.reload();
        openDocument(doc);
      } catch (error) {
        setAssignmentError(describeCanvasError(error, "assignments"));
      } finally {
        setBusyAssignmentId(null);
      }
    },
    [assignments, openDocument],
  );

  // --- import a file --------------------------------------------------------
  const onImport = useCallback(
    async (row: CourseFileRow) => {
      const name = canvasFileName(row.file);
      setImportError(null);
      setBlocked(null);
      setImporting({
        fileId: row.file.id,
        phase: "checking",
        done: 0,
        total: 0,
      });
      setImportStatus(`Starting import of ${name}…`);
      try {
        const doc = await importCanvasFile(row.file, {
          course: label || undefined,
          onProgress: (phase, done, total) => {
            setImporting({ fileId: row.file.id, phase, done, total });
            setImportStatus(describeImportPhase(phase, done, total));
          },
        });
        setImportStatus(
          `Imported “${name}” as a notebook with ${doc.pageCount} ${
            doc.pageCount === 1 ? "page" : "pages"
          }.`,
        );
        setLocalVersion((v) => v + 1);
        files.reload();
      } catch (error) {
        setImportStatus("");
        if (error instanceof CanvasDownloadError && error.canOpenInTab) {
          setBlocked({ message: error.message, url: error.url });
        } else {
          setImportError(describeCanvasError(error, "files"));
        }
      } finally {
        setImporting(null);
      }
    },
    [files, label],
  );

  // --- not connected --------------------------------------------------------
  if (!isConnected) {
    return (
      <section className="gn-canvas-browser" aria-label="Canvas">
        <div className="gn-canvas-empty-state">
          <h2>Connect Canvas to see your courses</h2>
          <p>
            Your assignments, their due dates and your course files, in here —
            read-only, and you can disconnect at any time.
          </p>
          <button
            type="button"
            className="gn-canvas-button gn-canvas-button--primary"
            onClick={openConnect}
          >
            Connect Canvas…
          </button>
        </div>
        {onConnect ? null : fallbackConnect.dialog}
      </section>
    );
  }

  const tabs: CanvasTabSpec<CourseBrowserTab>[] = [
    { id: "assignments", label: "Assignments", badge: assignments.data.length },
    { id: "files", label: "Files", badge: files.data.length },
    { id: "notebooks", label: "My notebooks", badge: notebooks.docs.length },
  ];

  const reconnectNeeded =
    needsReconnect(courses.cause) ||
    needsReconnect(assignments.cause) ||
    needsReconnect(files.cause);

  return (
    <section className="gn-canvas-browser" aria-label="Canvas course browser">
      <header className="gn-canvas-browser__head">
        <div className="gn-canvas-field gn-canvas-field--inline">
          <label htmlFor={`${ID_PREFIX}-course`}>Course</label>
          <select
            id={`${ID_PREFIX}-course`}
            className="gn-canvas-select"
            value={courseId ?? ""}
            onChange={(event) => setCourseId(event.target.value || null)}
            disabled={courses.isLoading || courses.data.length === 0}
          >
            {courses.data.length === 0 ? (
              <option value="">
                {courses.isLoading ? "Loading courses…" : "No courses"}
              </option>
            ) : null}
            {courses.data.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.term?.name ? ` — ${item.term.name}` : ""}
              </option>
            ))}
          </select>
        </div>

        <p className="gn-canvas-browser__who">
          {connection?.userName ? `${connection.userName} · ` : ""}
          {connection?.host}
        </p>

        <button
          type="button"
          className="gn-canvas-button gn-canvas-button--quiet"
          onClick={openConnect}
        >
          Canvas connection…
        </button>
      </header>

      {courses.error ? (
        <div className="gn-canvas-alert" role="alert">
          <span>{courses.error}</span>
          <button
            type="button"
            className="gn-canvas-button gn-canvas-button--quiet"
            onClick={reconnectNeeded ? openConnect : courses.reload}
          >
            {reconnectNeeded ? "Reconnect…" : "Try again"}
          </button>
        </div>
      ) : null}

      <CanvasTabs
        tabs={tabs}
        active={tab}
        onChange={setTab}
        idPrefix={ID_PREFIX}
        label="Course sections"
      />

      {/* --- Assignments ---------------------------------------------------- */}
      <div
        role="tabpanel"
        id={tabPanelId(ID_PREFIX, "assignments")}
        aria-labelledby={tabId(ID_PREFIX, "assignments")}
        tabIndex={0}
        hidden={tab !== "assignments"}
        className="gn-canvas-panel"
      >
        {assignments.isLoading ? (
          <p className="gn-canvas-empty">Loading assignments…</p>
        ) : null}
        {assignments.error ? (
          <div className="gn-canvas-alert" role="alert">
            <span>{assignments.error}</span>
            <button
              type="button"
              className="gn-canvas-button gn-canvas-button--quiet"
              onClick={
                needsReconnect(assignments.cause)
                  ? openConnect
                  : assignments.reload
              }
            >
              {needsReconnect(assignments.cause) ? "Reconnect…" : "Try again"}
            </button>
          </div>
        ) : null}
        {assignmentError ? (
          <p className="gn-canvas-alert" role="alert">
            {assignmentError}
          </p>
        ) : null}
        {!assignments.isLoading && !assignments.error ? (
          <AssignmentList
            rows={assignments.data}
            busyAssignmentId={busyAssignmentId}
            onOpenNotes={openDocument}
            onCreateNotes={onCreateNotes}
          />
        ) : null}
      </div>

      {/* --- Files ----------------------------------------------------------- */}
      <div
        role="tabpanel"
        id={tabPanelId(ID_PREFIX, "files")}
        aria-labelledby={tabId(ID_PREFIX, "files")}
        tabIndex={0}
        hidden={tab !== "files"}
        className="gn-canvas-panel"
      >
        {files.isLoading ? (
          <p className="gn-canvas-empty">Loading files…</p>
        ) : null}
        {files.error ? (
          <div className="gn-canvas-alert" role="alert">
            <span>{files.error}</span>
            <button
              type="button"
              className="gn-canvas-button gn-canvas-button--quiet"
              onClick={needsReconnect(files.cause) ? openConnect : files.reload}
            >
              {needsReconnect(files.cause) ? "Reconnect…" : "Try again"}
            </button>
          </div>
        ) : null}

        {/* mounted whether or not an import is running, so the first
            announcement is actually spoken */}
        <CanvasProgress
          message={importStatus}
          fraction={
            importing && importing.total > 0
              ? Math.min(1, importing.done / importing.total)
              : null
          }
          showBar={importing !== null}
        />

        {blocked ? (
          <div className="gn-canvas-notice" role="alert">
            <p>{blocked.message}</p>
            {blocked.url ? (
              <a
                className="gn-canvas-button gn-canvas-button--primary"
                href={blocked.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open the file in a new tab
              </a>
            ) : null}
            <p className="gn-canvas-hint">
              Save it from there and drop it onto the shelf — you get the same
              notebook.
            </p>
          </div>
        ) : null}

        {importError ? (
          <p className="gn-canvas-alert" role="alert">
            {importError}
          </p>
        ) : null}

        {!files.isLoading && !files.error ? (
          <div className="gn-canvas-files">
            <FileList
              rows={files.data}
              selectedFileId={selectedFileId}
              onSelect={(row) => setSelectedFileId(row.file.id)}
              onImport={onImport}
              onOpenImported={openDocument}
              busyFileId={importing?.fileId ?? null}
            />
            <FilePreviewPane
              row={selectedRow}
              onImport={onImport}
              isImporting={importing?.fileId === selectedRow?.file.id}
              disablePreview={disablePreview}
            />
          </div>
        ) : null}
      </div>

      {/* --- My notebooks ----------------------------------------------------- */}
      <div
        role="tabpanel"
        id={tabPanelId(ID_PREFIX, "notebooks")}
        aria-labelledby={tabId(ID_PREFIX, "notebooks")}
        tabIndex={0}
        hidden={tab !== "notebooks"}
        className="gn-canvas-panel"
      >
        {notebooks.isLoading ? (
          <p className="gn-canvas-empty">Loading notebooks…</p>
        ) : (
          <NotebookList
            docs={notebooks.docs}
            courseLabel={label || "this course"}
            onOpen={openDocument}
          />
        )}
      </div>

      {onConnect ? null : fallbackConnect.dialog}
    </section>
  );
};
