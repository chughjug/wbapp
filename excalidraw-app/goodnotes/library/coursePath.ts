/**
 * Nested courses ("MATH 221 / Problem sets") on top of the flat
 * `DocMeta.course` string.
 *
 * WHY A PATH STRING RATHER THAN A FOLDER ENTITY:
 * `DocMeta.course` is `string | null` in the shared contract
 * (goodnotes/types.ts), which this module may not widen. The two candidate
 * models were:
 *
 *   (a) a new "folder" entity in its own IndexedDB store, with documents
 *       pointing at a folder id;
 *   (b) a path-style delimiter inside the course string we already have.
 *
 * (b) wins, decisively:
 *   - no contract change, and no `parentId` field to smuggle onto `DocMeta`;
 *   - every existing consumer keeps working unchanged. A document whose
 *     course is "MATH 221" is simply a path of depth 1, so there is no
 *     migration, and a concurrent module that reads `doc.course` still sees a
 *     human-readable string rather than an opaque id;
 *   - the course-style store (courses.ts) is keyed by course name, so a path
 *     is already a usable key — a sub-course can carry its own colour/emoji;
 *   - no referential integrity to maintain. With (a), deleting a folder
 *     orphans documents and `deleteDoc` is not ours to change; here a folder
 *     literally *is* the set of documents whose path starts with it, so it
 *     cannot drift.
 *
 * The cost of (b) is that a rename is an N-document rewrite rather than a
 * one-row write, and that "/" becomes reserved inside a segment. Both are
 * handled here: `renameCoursePath` rewrites a node *and all its descendants*
 * in one batched store write, and `normalizeCoursePath` treats "/" strictly
 * as a separator (segments are trimmed and empties dropped), so a user can
 * never create a segment containing one.
 */

/** Separator stored inside `DocMeta.course`. */
export const COURSE_SEPARATOR = "/";

/** Separator as rendered to the user (spaced, for legibility). */
export const COURSE_SEPARATOR_DISPLAY = " / ";

/** Max nesting depth accepted; deeper input is clamped by joining the tail. */
export const MAX_COURSE_DEPTH = 4;

/** "A / B" -> ["A", "B"]. Empty segments are dropped. */
export const splitCoursePath = (path: string | null | undefined): string[] =>
  (path ?? "")
    .split(COURSE_SEPARATOR)
    .map((segment) => segment.trim())
    .filter(Boolean);

/** ["A", "B"] -> "A/B" (storage form). */
export const joinCoursePath = (segments: string[]): string =>
  segments
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(COURSE_SEPARATOR);

/**
 * Canonical storage form of raw user input, or `null` when it is empty.
 * Clamps to `MAX_COURSE_DEPTH` by folding any deeper tail into the last kept
 * segment (joined with a space) rather than silently dropping the user's text.
 */
export const normalizeCoursePath = (
  raw: string | null | undefined,
): string | null => {
  const segments = splitCoursePath(raw);
  if (segments.length === 0) {
    return null;
  }
  if (segments.length > MAX_COURSE_DEPTH) {
    const head = segments.slice(0, MAX_COURSE_DEPTH - 1);
    head.push(segments.slice(MAX_COURSE_DEPTH - 1).join(" "));
    return joinCoursePath(head);
  }
  return joinCoursePath(segments);
};

/** Human form: "MATH 221/Problem sets" -> "MATH 221 / Problem sets". */
export const formatCoursePath = (path: string): string =>
  splitCoursePath(path).join(COURSE_SEPARATOR_DISPLAY);

/** Last segment — what a folder card or tree row shows as its name. */
export const coursePathLabel = (path: string): string => {
  const segments = splitCoursePath(path);
  return segments[segments.length - 1] ?? path;
};

/** Parent path, or `null` for a root course. */
export const coursePathParent = (path: string): string | null => {
  const segments = splitCoursePath(path);
  return segments.length > 1 ? joinCoursePath(segments.slice(0, -1)) : null;
};

/** 1 for a root course. */
export const coursePathDepth = (path: string): number =>
  splitCoursePath(path).length;

/** Every ancestor of `path`, root first, excluding `path` itself. */
export const coursePathAncestors = (path: string): string[] => {
  const segments = splitCoursePath(path);
  const out: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    out.push(joinCoursePath(segments.slice(0, i)));
  }
  return out;
};

/** True when `path` sits strictly below `ancestor`. */
export const isDescendantCourse = (
  path: string | null | undefined,
  ancestor: string,
): boolean => {
  if (!path || !ancestor) {
    return false;
  }
  return path.startsWith(`${ancestor}${COURSE_SEPARATOR}`);
};

/** True for the node itself or anything below it — the "course filter" test. */
export const isInCourseTree = (
  path: string | null | undefined,
  root: string,
): boolean => !!path && (path === root || isDescendantCourse(path, root));

/**
 * Rewrite one path for a rename of `from` -> `to`. Returns `path` untouched
 * when it is neither `from` nor a descendant of it — which is what makes a
 * parent rename cascade to its children.
 */
export const rewriteCoursePath = (
  path: string,
  from: string,
  to: string,
): string => {
  if (path === from) {
    return to;
  }
  if (isDescendantCourse(path, from)) {
    return `${to}${path.slice(from.length)}`;
  }
  return path;
};

// ---------------------------------------------------------------------------
// tree
// ---------------------------------------------------------------------------

export interface CourseNode {
  /** Full storage path, e.g. "MATH 221/Problem sets". */
  path: string;
  /** Last segment only. */
  label: string;
  /** 1-based. */
  depth: number;
  /** Documents whose course is exactly this path. */
  count: number;
  /** `count` plus every descendant's count. */
  totalCount: number;
  children: CourseNode[];
}

/**
 * Build the course tree from the distinct course paths in the library.
 * Intermediate paths that no document uses directly ("MATH 221" when only
 * "MATH 221/Problem sets" exists) are synthesised, so a sub-course is never
 * orphaned in the sidebar.
 */
export const buildCourseTree = (
  paths: readonly string[],
  countOf: (path: string) => number,
): CourseNode[] => {
  const nodes = new Map<string, CourseNode>();

  const ensure = (path: string): CourseNode => {
    const existing = nodes.get(path);
    if (existing) {
      return existing;
    }
    const node: CourseNode = {
      path,
      label: coursePathLabel(path),
      depth: coursePathDepth(path),
      count: countOf(path),
      totalCount: 0,
      children: [],
    };
    nodes.set(path, node);
    const parent = coursePathParent(path);
    if (parent) {
      ensure(parent).children.push(node);
    }
    return node;
  };

  for (const path of paths) {
    if (path) {
      ensure(path);
    }
  }

  const roots: CourseNode[] = [];
  for (const node of nodes.values()) {
    if (!coursePathParent(node.path)) {
      roots.push(node);
    }
  }

  const sortRec = (list: CourseNode[]): number => {
    list.sort((a, b) => a.label.localeCompare(b.label));
    let total = 0;
    for (const node of list) {
      node.totalCount = node.count + sortRec(node.children);
      total += node.totalCount;
    }
    return total;
  };
  sortRec(roots);

  return roots;
};

/** Depth-first flattening of a tree, parents before children. */
export const flattenCourseTree = (nodes: readonly CourseNode[]): CourseNode[] =>
  nodes.flatMap((node) => [node, ...flattenCourseTree(node.children)]);
