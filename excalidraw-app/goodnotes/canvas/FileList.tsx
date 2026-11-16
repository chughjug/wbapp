/**
 * The Files tab's list.
 *
 * Non-PDFs are **shown, not hidden** — a student looking for "Week 3 slides"
 * should see that the file exists and that we can't turn it into pages,
 * rather than wonder whether Canvas is broken. Those rows are visibly inert:
 * dimmed, with the reason spelled out, and their Import button is `disabled`
 * rather than a button that fails when pressed.
 */

import React from "react";

import { formatBytes, formatShortDate } from "../library";

import { canvasFileName, describeUnsupportedFile } from "./files";

import type { CourseFileRow } from "./useCanvasData";
import type { DocMeta } from "../types";

export interface FileListProps {
  rows: readonly CourseFileRow[];
  selectedFileId: string | null;
  onSelect: (row: CourseFileRow) => void;
  onImport: (row: CourseFileRow) => void;
  onOpenImported: (doc: DocMeta) => void;
  /** Id of the file being imported right now. */
  busyFileId?: string | null;
}

export const FileList: React.FC<FileListProps> = ({
  rows,
  selectedFileId,
  onSelect,
  onImport,
  onOpenImported,
  busyFileId = null,
}) => {
  if (rows.length === 0) {
    return (
      <p className="gn-canvas-empty">
        No files in this course — or the Files area is hidden from students.
      </p>
    );
  }

  return (
    <ul className="gn-canvas-list gn-canvas-list--files">
      {rows.map((row) => {
        const name = canvasFileName(row.file);
        const isSelected = row.file.id === selectedFileId;
        const isBusy = busyFileId === row.file.id;
        return (
          <li
            key={row.file.id}
            className={`gn-canvas-row gn-canvas-row--file${
              row.isPdf ? "" : " gn-canvas-row--inert"
            }${isSelected ? " gn-canvas-row--selected" : ""}`}
          >
            <button
              type="button"
              className="gn-canvas-filebutton"
              aria-pressed={isSelected}
              onClick={() => onSelect(row)}
            >
              <span className="gn-canvas-row__title">{name}</span>
              <span className="gn-canvas-row__meta">
                {typeof row.file.size === "number" ? (
                  <span>{formatBytes(row.file.size)}</span>
                ) : (
                  <span>Size unknown</span>
                )}
                <span className="gn-canvas-row__dot" aria-hidden="true">
                  ·
                </span>
                <span>
                  {row.file.updated_at
                    ? `Updated ${formatShortDate(
                        new Date(row.file.updated_at).getTime(),
                      )}`
                    : "Never updated"}
                </span>
                {!row.isPdf ? (
                  <>
                    <span className="gn-canvas-row__dot" aria-hidden="true">
                      ·
                    </span>
                    <span className="gn-canvas-row__why">
                      {describeUnsupportedFile(row.file)}
                    </span>
                  </>
                ) : null}
                {row.imported ? (
                  <>
                    <span className="gn-canvas-row__dot" aria-hidden="true">
                      ·
                    </span>
                    <span className="gn-canvas-badge">Already imported</span>
                  </>
                ) : null}
              </span>
            </button>

            <div className="gn-canvas-row__actions">
              {row.imported ? (
                <button
                  type="button"
                  className="gn-canvas-button gn-canvas-button--primary"
                  onClick={() => row.imported && onOpenImported(row.imported)}
                >
                  Open
                  <span className="gn-canvas-sr">
                    {" "}
                    the notebook imported from {name}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  className="gn-canvas-button gn-canvas-button--primary"
                  disabled={!row.isPdf || isBusy}
                  onClick={() => onImport(row)}
                  title={
                    row.isPdf ? undefined : describeUnsupportedFile(row.file)
                  }
                >
                  {isBusy ? "Importing…" : "Import"}
                  <span className="gn-canvas-sr">
                    {row.isPdf
                      ? ` ${name} as a notebook`
                      : ` ${name} — unavailable, ${describeUnsupportedFile(
                          row.file,
                        ).toLowerCase()}`}
                  </span>
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};
