/**
 * The one string formatter this module needs.
 *
 * `goodnotes/library` exports `formatUpdatedAt`, but importing it here would
 * tie the sync UI to the shelf's wording ("Edited 3 minutes ago"), which is
 * not what a sync status line says. Ten lines is cheaper than the coupling.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "3 minutes ago", "2 hours ago", "on 4 Mar". */
export const formatRelativeTime = (
  timestamp: number,
  now: number = Date.now(),
): string => {
  const delta = Math.max(0, now - timestamp);
  if (delta < MINUTE) {
    return "just now";
  }
  if (delta < HOUR) {
    const minutes = Math.round(delta / MINUTE);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (delta < DAY) {
    const hours = Math.round(delta / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  return `on ${new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })}`;
};
