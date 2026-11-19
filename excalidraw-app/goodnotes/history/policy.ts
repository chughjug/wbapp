/**
 * Which snapshots are worth keeping.
 *
 * Version history has to answer "put back what this page looked like an hour
 * ago" without turning into an unbounded copy of every save. Two rules do
 * that, and they are pure functions here so they can be reasoned about and
 * tested without a database:
 *
 * 1. **Rate limit** (`shouldSnapshot`) — at most one snapshot per interval
 *    per document. The editor saves every 750 ms while a pen is moving; a
 *    snapshot per save would multiply the database by the length of a
 *    lecture.
 *
 * 2. **Thinning** (`snapshotsToDrop`) — older history gets coarser. Recent
 *    minutes are what a mistake is usually undone from, so they stay dense;
 *    a snapshot from last Tuesday only needs to exist once for that day.
 *
 * The thinning is deliberately *not* "keep the newest N". A flat cap means a
 * busy afternoon evicts the whole of the previous week, which is exactly the
 * history a student reaches for when they realise a page has been wrong
 * since Monday.
 */

/** Minimum gap between two snapshots of the same document. */
export const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

/** How long any snapshot is kept at all. */
export const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Resolution bands, coarsest last. Within `within` of now, at most one
 * snapshot per `every`.
 */
const BANDS: readonly { within: number; every: number }[] = [
  { within: HOUR, every: 5 * MINUTE },
  { within: DAY, every: HOUR },
  { within: 7 * DAY, every: 6 * HOUR },
  { within: HISTORY_RETENTION_MS, every: DAY },
];

/** Anything a snapshot list needs to be thinned; the scene is not read. */
export interface SnapshotHeader {
  /** Snapshot id, opaque here. */
  id: string;
  /** When the snapshot was taken. */
  at: number;
  /**
   * A snapshot the user asked for by name, or one taken immediately before a
   * restore. Never dropped by thinning — the whole point of marking it was
   * that an automatic rule would not have kept it.
   */
  pinned?: boolean;
}

/**
 * Is `now` far enough past the newest existing snapshot to take another?
 *
 * `latestAt` is null when the document has no history yet, which always
 * snapshots: the first save of a session is the cheapest moment to record
 * what the document looked like before today's edits.
 */
export const shouldSnapshot = (
  latestAt: number | null,
  now: number,
  interval: number = SNAPSHOT_INTERVAL_MS,
): boolean => latestAt === null || now - latestAt >= interval;

const bandFor = (age: number): { within: number; every: number } | null => {
  for (const band of BANDS) {
    if (age <= band.within) {
      return band;
    }
  }
  return null;
};

/**
 * Snapshot ids that thinning would discard, given the full list for one
 * document.
 *
 * The newest snapshot in each time bucket survives; older ones in the same
 * bucket go. Anything past the retention window goes regardless of bucket,
 * and a pinned snapshot never goes. The very newest snapshot overall is
 * always kept even if it has aged out, so a document edited once a year
 * still has one point to go back to.
 */
export const snapshotsToDrop = (
  snapshots: readonly SnapshotHeader[],
  now: number,
): string[] => {
  const ordered = [...snapshots].sort((a, b) => b.at - a.at);
  const keptBuckets = new Set<string>();
  const drop: string[] = [];

  const bucketOf = (at: number): string | null => {
    const band = bandFor(Math.max(0, now - at));
    return band ? `${band.every}:${Math.floor(at / band.every)}` : null;
  };

  // Pinned snapshots claim their buckets up front, before anything else is
  // considered. A pinned snapshot is a moment the user named — or the state
  // rescued just before a restore — so an automatic snapshot taken seconds
  // either side of it is a duplicate of that same moment and should be the
  // one that goes. Seeding here rather than inside the loop is what makes
  // that true regardless of which of the two is marginally newer.
  for (const snapshot of ordered) {
    if (snapshot.pinned) {
      const bucket = bucketOf(snapshot.at);
      if (bucket) {
        keptBuckets.add(bucket);
      }
    }
  }

  ordered.forEach((snapshot, index) => {
    if (snapshot.pinned) {
      return;
    }
    const bucket = bucketOf(snapshot.at);

    // index 0 is the newest snapshot of the document. It is kept whatever
    // its age — a document last touched a year ago still deserves one point
    // to go back to — but it does claim its bucket, so the next snapshot
    // down is thinned normally rather than getting a free pass.
    if (index === 0) {
      if (bucket) {
        keptBuckets.add(bucket);
      }
      return;
    }

    if (!bucket) {
      drop.push(snapshot.id);
      return;
    }
    if (keptBuckets.has(bucket)) {
      drop.push(snapshot.id);
    } else {
      keptBuckets.add(bucket);
    }
  });

  return drop;
};
