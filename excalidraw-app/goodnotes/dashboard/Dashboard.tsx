/**
 * The home screen: a dashboard layered *above* the library, never instead of
 * it.
 *
 * Layout
 *   [ Due soon        — deadline cards, soonest first ]   <- Canvas only
 *   [ Your courses    — notebooks + Canvas work       ]   <- Canvas only
 *   [ <Shelf/>        — the library, untouched        ]   <- always
 *
 * DEGRADING GRACEFULLY IS THE DESIGN, NOT A FALLBACK.
 * With no Canvas connection the top region is not rendered at all: no strip,
 * no course cards, no empty states, no error, no spinner, no request. What
 * remains is the library — which already has its own due dates, its own
 * "Due this week" filter and its own course folders — plus one dismissible
 * sentence inviting the user to connect. That screen is complete on its own
 * terms; nothing on it refers to a feature the user does not have.
 *
 * HEADINGS: `Shelf` renders the page's `<h1>` (the current filter's name) and
 * is not ours to edit, so this layer deliberately contributes no `h1`. Its
 * two sections are `<h2>`s labelling `<section>`s, which keeps exactly one
 * `h1` on the page and skips no level.
 *
 * NO LAYOUT SHIFT: when Canvas *is* connected, the strip and the course row
 * reserve their height with same-sized placeholders from the first paint, so
 * the document grid does not move when the deadlines land.
 */

import React, { useCallback, useId, useMemo, useRef, useState } from "react";

import { Shelf, useCourseStyles, useDocuments } from "../library";

import { ConnectInvite } from "./ConnectInvite";
import { CourseCards } from "./CourseCards";
import { DueSoonStrip } from "./DueSoonStrip";
import { dismissConnectInvite, isConnectInviteDismissed } from "./dismissal";
import { buildCourseSummaries } from "./model";
import { selectCourseInShelf } from "./shelfBridge";
import { useUpcomingWork } from "./useUpcomingWork";

import "./Dashboard.scss";

import type { LibraryView } from "../library";
import type { DocMeta } from "../types";

export interface DashboardProps {
  /** Called when the user opens — or creates — a document. Same contract as
   *  `Shelf`'s own prop; the deadline cards route through it too. */
  onOpenDocument: (doc: DocMeta) => void;
  /** Drives the Excalidraw CSS custom properties. Defaults to `"light"`. */
  theme?: "light" | "dark";
  /** Passed straight through to `Shelf`'s header slot. */
  headerExtra?: React.ReactNode;
  className?: string;
  /** Passed straight through to `Shelf`. */
  defaultView?: LibraryView;
  /**
   * Opens the host's Canvas connect flow. When omitted the invitation points
   * at Settings in words instead of showing a button that leads nowhere.
   */
  onConnectCanvas?: () => void;
}

export const Dashboard = ({
  onOpenDocument,
  theme = "light",
  headerExtra,
  className,
  defaultView,
  onConnectCanvas,
}: DashboardProps) => {
  const work = useUpcomingWork();
  const { documents } = useDocuments();
  const courseStyles = useCourseStyles();
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [inviteDismissed, setInviteDismissed] = useState(() =>
    isConnectInviteDismissed(),
  );

  const dueHeadingId = `${useId()}-due`;
  const coursesHeadingId = `${useId()}-courses`;

  // one clock read per data change keeps every badge mutually consistent
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [work.rows, work.lastSyncedAt]);

  const summaries = useMemo(
    () => buildCourseSummaries(work.rows, documents, now),
    [work.rows, documents, now],
  );

  const handleSelectCourse = useCallback((course: string) => {
    selectCourseInShelf(rootRef.current, course);
  }, []);

  const handleDismiss = useCallback(() => {
    dismissConnectInvite();
    setInviteDismissed(true);
  }, []);

  const connected = work.status !== "disconnected";

  return (
    <div
      ref={rootRef}
      className={`excalidraw${theme === "dark" ? " theme--dark" : ""} gn-dash${
        className ? ` ${className}` : ""
      }`}
    >
      {connected && (
        <div className="gn-dash__top">
          <DueSoonStrip
            state={work}
            now={now}
            styleOf={courseStyles.styleOf}
            onOpenDocument={onOpenDocument}
            headingId={dueHeadingId}
          />
          <CourseCards
            summaries={summaries}
            styleOf={courseStyles.styleOf}
            onSelectCourse={handleSelectCourse}
            loading={work.status === "loading" && work.rows.length === 0}
            headingId={coursesHeadingId}
          />
        </div>
      )}

      {!connected && !inviteDismissed && (
        <ConnectInvite onConnect={onConnectCanvas} onDismiss={handleDismiss} />
      )}

      <div className="gn-dash__shelf">
        <Shelf
          theme={theme}
          onOpenDocument={onOpenDocument}
          headerExtra={headerExtra}
          defaultView={defaultView}
        />
      </div>
    </div>
  );
};

export default Dashboard;
