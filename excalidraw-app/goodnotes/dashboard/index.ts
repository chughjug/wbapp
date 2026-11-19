/**
 * GoodNotes dashboard — public API.
 *
 * The home screen of the app: "what is due, and what do I open next",
 * rendered *above* the existing document library rather than in place of it.
 *
 * ```tsx
 * import { Dashboard } from "./goodnotes/dashboard";
 *
 * <Dashboard
 *   theme={editorTheme}
 *   onOpenDocument={openDocument}
 *   headerExtra={<PdfDropZone variant="inline" />}
 * />
 * ```
 *
 * `Dashboard` is a drop-in replacement for `<Shelf />`: it takes the same
 * `onOpenDocument` / `theme` / `headerExtra` / `className` / `defaultView`
 * props, renders `Shelf` itself, and adds the Canvas-driven layer on top.
 * See INTEGRATION.md for the exact App.tsx change.
 *
 * WHAT IT RENDERS, BY STATE
 *
 *   Canvas not connected (the default, and permanent for many users)
 *     The library, plus one dismissible sentence inviting a connection.
 *     No deadline strip, no course cards, no empty states, no spinner, no
 *     error — and no network request is made at all.
 *
 *   Canvas connected, loading
 *     The strip and the course row render same-sized placeholders, so the
 *     document grid does not move when the deadlines land.
 *
 *   Canvas connected, request failed (offline, revoked token)
 *     The library, plus a small inline notice with a "Try again" button in
 *     the space the strip occupies. Cards already on screen are kept.
 *
 *   Canvas connected, loaded
 *     "Due soon" (soonest first, each card one action: Open notes / Create
 *     notes) and "Your courses", above the library.
 *
 * ACCESSIBILITY CONTRACT
 *  - no `h1` is added: `Shelf` owns the page's single `h1`, and this layer's
 *    two sections are `h2`-labelled `<section>`s.
 *  - each deadline card is one real `<button>` — one tab stop, one action —
 *    whose accessible name states the action, the assignment, its course and
 *    its urgency in words.
 *  - urgency is never colour alone: every chip carries its text label.
 *  - sync state and action failures are announced through a single
 *    `role="status" aria-live="polite"` region.
 *  - visible `:focus-visible` rings; `prefers-reduced-motion: reduce`
 *    disables the card transitions and the skeleton pulse.
 *  - light and dark theme come from Excalidraw's own custom properties.
 */

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

/** The home screen. Renders `Shelf` internally — do not render both. */
export { Dashboard } from "./Dashboard";
export type { DashboardProps } from "./Dashboard";

/** Pieces, exported so a host can compose a different arrangement. */
export { DueSoonStrip } from "./DueSoonStrip";
export type { DueSoonStripProps } from "./DueSoonStrip";
export { CourseCards } from "./CourseCards";
export type { CourseCardsProps } from "./CourseCards";
export { DeadlineCard, DeadlineSkeleton } from "./DeadlineCard";
export type { DeadlineCardProps } from "./DeadlineCard";
export { ConnectInvite } from "./ConnectInvite";
export type { ConnectInviteProps } from "./ConnectInvite";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Loads Canvas deadlines. Reads `isCanvasConnected()` synchronously on the
 * first render, so a disconnected user never flashes a loading state and no
 * request is issued.
 */
export { useUpcomingWork } from "./useUpcomingWork";
export type { UpcomingWorkState, UpcomingWorkStatus } from "./useUpcomingWork";

/** Persistence for the one dismissible invitation on the screen. */
export {
  isConnectInviteDismissed,
  dismissConnectInvite,
  resetConnectInvite,
} from "./dismissal";

// ---------------------------------------------------------------------------
// Model (pure — no React, no IndexedDB, no network)
// ---------------------------------------------------------------------------

export {
  /** Strip contents: soonest first, stale overdue dropped, capped. */
  buildDeadlines,
  /** One summary per Canvas course, most urgent first. */
  buildCourseSummaries,
  toDeadlineItem,
  courseLabelOf,
  MAX_DEADLINE_CARDS,
} from "./model";
export type { DeadlineItem, CourseSummary } from "./model";

export {
  getUrgency,
  urgencyLabel,
  urgencyRank,
  daysUntil,
  formatDeadline,
  formatRelative,
  OVERDUE_GRACE_MS,
} from "./urgency";
export type { DeadlineUrgency } from "./urgency";

/**
 * Selects a course in the library's own sidebar. `Shelf` keeps its filter in
 * local state and exposes no setter, so this drives the control the library
 * already renders; it fails soft when the row is not present.
 */
export { selectCourseInShelf, findCourseButton } from "./shelfBridge";

export { PinnedStrip, orderPinned, MAX_PINNED_SHOWN } from "./PinnedStrip";
export type { PinnedStripProps } from "./PinnedStrip";
