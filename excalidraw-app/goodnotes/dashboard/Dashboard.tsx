/**
 * The home screen: a dashboard layered *above* the library, never instead of
 * it.
 *
 * Layout
 *   [ Up next         — deadline timeline, soonest first ]  <- Canvas only
 *   [ Your courses    — quiet course chips               ]  <- Canvas only
 *   [ <Shelf/>        — the home screen                  ]  <- always
 *
 * DEGRADING GRACEFULLY IS THE DESIGN, NOT A FALLBACK.
 * With no Canvas connection the top region is not rendered at all: no strip,
 * no course chips, no empty states, no error, no spinner, no request. What
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

import { isFavourite, Shelf, useCourseStyles, useDocuments } from "../library";

import { ConnectInvite } from "./ConnectInvite";
import { CourseCards } from "./CourseCards";
import { DueSoonStrip } from "./DueSoonStrip";
import { UpNextStrip } from "./UpNextStrip";
import { buildLocalDeadlines } from "./localDeadlines";
import { FavouritesStrip, orderFavourites } from "./FavouritesStrip";
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
  /**
   * When set, Shelf New / empty-state create open the host's create flow
   * (format picker) instead of creating immediately.
   */
  onCreateDocument?: (init: Partial<DocMeta>) => void;
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
  onCreateDocument,
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
  const upNextHeadingId = `${useId()}-up-next`;
  const coursesHeadingId = `${useId()}-courses`;
  const favouritesHeadingId = `${useId()}-favourites`;

  // One clock read per data change keeps every badge mutually consistent.
  // `documents` is in here as well as the Canvas state because the local
  // "Up next" strip reads this clock: without it, editing a due date would
  // re-bucket the row against the time the screen first loaded.
  /* eslint-disable react-hooks/exhaustive-deps */
  const now = useMemo(
    () => Date.now(),
    [work.rows, work.lastSyncedAt, documents],
  );
  /* eslint-enable react-hooks/exhaustive-deps */

  // a deleted notebook is not part of anyone's workload, so it must not
  // appear in a course summary or count toward one
  const liveDocuments = useMemo(
    () => documents.filter((doc) => typeof doc.deletedAt !== "number"),
    [documents],
  );

  const summaries = useMemo(
    () => buildCourseSummaries(work.rows, liveDocuments, now),
    [work.rows, liveDocuments, now],
  );

  const handleSelectCourse = useCallback((course: string) => {
    selectCourseInShelf(rootRef.current, course);
  }, []);

  const handleDismiss = useCallback(() => {
    dismissConnectInvite();
    setInviteDismissed(true);
  }, []);

  const connected = work.status !== "disconnected";

  /**
   * The library's own deadlines, for the screen with no Canvas connection.
   *
   * Only then: with Canvas on, the strip above already answers "what is
   * due", and two deadline rows on one screen — one from the LMS, one from
   * the notebooks — would be the same question answered twice.
   */
  const localDeadlines = useMemo(
    () => (connected ? [] : buildLocalDeadlines(liveDocuments, now)),
    [connected, liveDocuments, now],
  );

  /**
   * Starred notebooks, most recently opened first.
   *
   * Shown whether or not Canvas is connected: "what is due" and "what am I
   * working in" are different questions, and this row answers the second
   * in a single tap rather than a filter click.
   *
   * Minus anything already in the deadline row below it. Without that, a
   * starred notebook that is also due soon takes two of the handful of
   * slots above the fold — measured on a realistic library, one notebook
   * occupied the hero card, a deadline tile and a favourites tile at the
   * same time, on a phone where only one card fits on screen at all.
   */
  const favourites = useMemo(() => {
    const alreadyShown = new Set(localDeadlines.map((item) => item.doc.id));
    return orderFavourites(
      liveDocuments.filter(
        (doc) => isFavourite(doc) && !alreadyShown.has(doc.id),
      ),
    );
  }, [liveDocuments, localDeadlines]);

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

      {/* One band, not one per strip: each `gn-dash__top` carries its own
          padding and bottom border, so stacking them put ~200px of fixed
          chrome above the library on desktop and nearly half the viewport
          on a phone. */}
      {!connected && (localDeadlines.length > 0 || favourites.length > 0) && (
        <div className="gn-dash__top">
          {localDeadlines.length > 0 && (
            <UpNextStrip
              items={localDeadlines}
              now={now}
              styleOf={courseStyles.styleOf}
              onOpenDocument={onOpenDocument}
              headingId={upNextHeadingId}
            />
          )}
          {favourites.length > 0 && (
            <FavouritesStrip
              items={favourites}
              styleOf={courseStyles.styleOf}
              onOpenDocument={onOpenDocument}
              headingId={favouritesHeadingId}
            />
          )}
        </div>
      )}

      {connected && favourites.length > 0 && (
        <div className="gn-dash__top">
          <FavouritesStrip
            items={favourites}
            styleOf={courseStyles.styleOf}
            onOpenDocument={onOpenDocument}
            headingId={favouritesHeadingId}
          />
        </div>
      )}

      <div className="gn-dash__shelf">
        <Shelf
          theme={theme}
          onOpenDocument={onOpenDocument}
          onCreateDocument={onCreateDocument}
          headerExtra={headerExtra}
          defaultView={defaultView}
          menuExtra={
            !connected && !inviteDismissed ? (
              <ConnectInvite
                onConnect={onConnectCanvas}
                onDismiss={handleDismiss}
              />
            ) : null
          }
        />
      </div>
    </div>
  );
};

export default Dashboard;
