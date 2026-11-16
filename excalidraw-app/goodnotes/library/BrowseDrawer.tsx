/**
 * Everything the old left sidebar held, moved one tap away.
 *
 * The sidebar was 15rem of permanent screen — on a first run, 15rem of five
 * zero counters and two paragraphs explaining courses and tags to someone who
 * has neither. It is not deleted: it is *revealed*. `Sidebar` is rendered
 * verbatim inside this drawer, so the smart filters, the nested course tree
 * with its rename/remove actions, the tag index with rename/delete, and the
 * storage meter all behave exactly as before — they just stop charging rent.
 *
 * Accessibility: a real modal dialog. Focus moves in on open and is trapped
 * while it is up; `Escape` and the backdrop close it; focus returns to the
 * control that opened it. Choosing a filter closes it, because that is the
 * reason you opened it.
 */

import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { CourseFolders } from "./CourseFolders";
import { Sidebar } from "./Sidebar";
import { Icon, ICON_CLOSE } from "./icons";
import { useShelfTheme } from "./theme";

import type { CourseFoldersProps } from "./CourseFolders";
import type { SidebarProps } from "./Sidebar";

export interface BrowseDrawerProps extends SidebarProps, CourseFoldersProps {
  onClose: () => void;
}

export const BrowseDrawer = ({
  onClose,
  folders,
  activeCourse,
  onOpenCourse,
  onSetColor,
  onSetEmoji,
  ...sidebar
}: BrowseDrawerProps) => {
  const theme = useShelfTheme();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>("button");
    first?.focus();
    const target = returnTo.current;
    return () => target?.focus?.();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const items = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? []),
    ];
    if (items.length === 0) {
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className={`excalidraw gn-portal${
        theme === "dark" ? " theme--dark" : ""
      }`}
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div className="gn-drawer__scrim" onClick={onClose} />
      <div
        ref={panelRef}
        className="gn-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Browse courses and tags"
        onKeyDown={onKeyDown}
      >
        <div className="gn-drawer__head">
          <h2 className="gn-drawer__title">Browse</h2>
          <button
            type="button"
            className="gn-icon-button"
            aria-label="Close browse"
            onClick={onClose}
          >
            <Icon path={ICON_CLOSE} />
          </button>
        </div>
        <div className="gn-drawer__body">
          <Sidebar
            {...sidebar}
            onSelectFilter={(filter) => {
              sidebar.onSelectFilter(filter);
              onClose();
            }}
          />
          {/*
            Last, and deliberately below the index: course colour and emoji
            are only editable from these cards, so dropping the folder row
            from the home screen would have dropped the feature. It is a
            customisation panel now, not a second way to navigate.
          */}
          <CourseFolders
            folders={folders}
            activeCourse={activeCourse}
            onOpenCourse={onOpenCourse}
            onSetColor={onSetColor}
            onSetEmoji={onSetEmoji}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default BrowseDrawer;
