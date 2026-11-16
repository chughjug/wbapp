/**
 * Per-course presentation state (colour + emoji) and the React binding for it.
 *
 * WHY A SEPARATE STORE: `DocMeta` (goodnotes/types.ts) is the shared contract
 * and must not be widened. A course is not a document anyway — it is a *group*
 * of them, identified only by the free-text `DocMeta.course` string, so its
 * colour and icon have nowhere sensible to live on a document row (storing it
 * there would duplicate the value across every document of the course and make
 * "recolour this course" an N-row write that can half-fail).
 *
 * So: one more `idb-keyval` database, same pattern as `store.ts`, keyed by the
 * course name.
 *
 *   db "goodnotes-courses" / store "styles" -> CourseStyle, keyed by name
 *
 * A course with no stored row still has a colour: `defaultCourseColor` derives
 * a stable hue from the name, so the UI is never colourless and a user only
 * ever customises *away* from a sensible default.
 */

import { createStore, del, entries, set } from "idb-keyval";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const styleStore = createStore("goodnotes-courses", "styles");

/** Customisable presentation for one course folder. */
export interface CourseStyle {
  /** `#rrggbb`, lowercase. */
  color: string;
  /** A single emoji (grapheme), or `null` for the generated initial. */
  emoji: string | null;
}

/** Stored rows, keyed by course name. */
export type CourseStyleMap = Record<string, CourseStyle>;

/**
 * Folder swatches. Mid-tone hues that stay legible as a dot and as a 12%
 * wash in both themes (they are never used as text or as the only signal).
 */
export const COURSE_COLOR_PRESETS: { value: string; label: string }[] = [
  { value: "#4b6bfb", label: "Blue" },
  { value: "#8b5cf6", label: "Violet" },
  { value: "#d946a6", label: "Magenta" },
  { value: "#e2574c", label: "Red" },
  { value: "#ef8c3b", label: "Orange" },
  { value: "#d4a017", label: "Amber" },
  { value: "#3f9c6d", label: "Green" },
  { value: "#17a2b8", label: "Teal" },
  { value: "#6b7280", label: "Grey" },
];

/** Emoji offered by the folder customisation picker. */
export const COURSE_EMOJI_PRESETS = [
  "📘",
  "📗",
  "📙",
  "📕",
  "📓",
  "🧪",
  "🔬",
  "🧬",
  "🧮",
  "📐",
  "📊",
  "💻",
  "⚙️",
  "🎨",
  "🎵",
  "🏛️",
  "🌍",
  "🧠",
  "❤️",
  "⚖️",
  "🗣️",
  "✍️",
  "🏃",
  "⭐",
];

/** Stable hex colour for a course that has never been customised. */
export const defaultCourseColor = (course: string): string => {
  let hash = 0;
  for (let i = 0; i < course.length; i++) {
    hash = (hash * 31 + course.charCodeAt(i)) % 1000003;
  }
  return COURSE_COLOR_PRESETS[hash % COURSE_COLOR_PRESETS.length].value;
};

/** The effective style of a course, falling back to the derived default. */
export const resolveCourseStyle = (
  course: string,
  styles: CourseStyleMap,
): CourseStyle => {
  const stored = styles[course];
  return {
    color: normalizeHex(stored?.color) ?? defaultCourseColor(course),
    emoji: stored?.emoji ?? null,
  };
};

/**
 * `#abc` / `abc` / `#AABBCC` -> `#aabbcc`. Returns null for anything else, so
 * a half-typed hex in the colour input never reaches storage or CSS.
 */
export const normalizeHex = (
  value: string | undefined | null,
): string | null => {
  if (!value) {
    return null;
  }
  const raw = value.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(raw)) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
  }
  if (/^[0-9a-f]{6}$/.test(raw)) {
    return `#${raw}`;
  }
  return null;
};

/** "#aabbcc" -> "170 187 204", for `rgb(var(--x) / 12%)` tints. */
export const hexToRgbChannels = (hex: string): string => {
  const normalized = normalizeHex(hex) ?? "#6b7280";
  const int = parseInt(normalized.slice(1), 16);
  // eslint-disable-next-line no-bitwise
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
};

/** Human-readable name of the nearest preset, for accessible announcements. */
export const describeColor = (hex: string): string => {
  const normalized = normalizeHex(hex);
  const preset = COURSE_COLOR_PRESETS.find((it) => it.value === normalized);
  return preset ? preset.label : `custom colour ${normalized ?? hex}`;
};

// ---------------------------------------------------------------------------
// persistence + notification (mirrors store.ts)
// ---------------------------------------------------------------------------

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe to course-style mutations. Returns an unsubscribe function. */
export const subscribeCourseStyles = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const emitChange = () => {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error: any) {
      console.error("goodnotes/library: course listener threw", error);
    }
  }
};

/** Every stored course style, as a plain map. */
export const listCourseStyles = async (): Promise<CourseStyleMap> => {
  const rows = (await entries(styleStore)) as [IDBValidKey, CourseStyle][];
  const map: CourseStyleMap = {};
  for (const [key, value] of rows) {
    if (typeof key === "string" && value && typeof value === "object") {
      map[key] = {
        color: normalizeHex(value.color) ?? defaultCourseColor(key),
        emoji: typeof value.emoji === "string" ? value.emoji : null,
      };
    }
  }
  return map;
};

/** Merge a patch into one course's style row, creating it if needed. */
export const setCourseStyle = async (
  course: string,
  patch: Partial<CourseStyle>,
): Promise<CourseStyle> => {
  const key = course.trim();
  if (!key) {
    throw new Error("goodnotes/library: course name is required");
  }
  const current = (await listCourseStyles())[key];
  const next: CourseStyle = {
    color:
      normalizeHex(patch.color) ?? current?.color ?? defaultCourseColor(key),
    emoji:
      patch.emoji === undefined ? current?.emoji ?? null : patch.emoji || null,
  };
  await set(key, next, styleStore);
  emitChange();
  return next;
};

/** Drop a course's customisation; it falls back to the derived default. */
export const resetCourseStyle = async (course: string): Promise<void> => {
  await del(course, styleStore);
  emitChange();
};

// ---------------------------------------------------------------------------
// React binding
// ---------------------------------------------------------------------------

export interface UseCourseStylesResult {
  styles: CourseStyleMap;
  /** Effective style for a course (stored row or derived default). */
  styleOf: (course: string) => CourseStyle;
  setColor: (course: string, color: string) => Promise<void>;
  setEmoji: (course: string, emoji: string | null) => Promise<void>;
  reset: (course: string) => Promise<void>;
}

export const useCourseStyles = (): UseCourseStylesResult => {
  const [styles, setStyles] = useState<CourseStyleMap>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const read = () => {
      void listCourseStyles()
        .then((map) => {
          if (mountedRef.current) {
            setStyles(map);
          }
        })
        .catch((error: any) => {
          console.error(
            "goodnotes/library: failed to read course styles",
            error,
          );
        });
    };
    read();
    const unsubscribe = subscribeCourseStyles(read);
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, []);

  const styleOf = useCallback(
    (course: string) => resolveCourseStyle(course, styles),
    [styles],
  );

  return useMemo(
    () => ({
      styles,
      styleOf,
      setColor: async (course: string, color: string) => {
        const hex = normalizeHex(color);
        if (hex) {
          await setCourseStyle(course, { color: hex });
        }
      },
      setEmoji: async (course: string, emoji: string | null) => {
        await setCourseStyle(course, { emoji });
      },
      reset: resetCourseStyle,
    }),
    [styles, styleOf],
  );
};

// ---------------------------------------------------------------------------
// hierarchy maintenance
// ---------------------------------------------------------------------------

/**
 * Follow a course rename in the style store: the row for `from` moves to
 * `to`, and so does every nested course's row ("MATH 221/Labs" ->
 * "MATH 230/Labs"). Without this a renamed folder would silently lose its
 * colour and emoji, since the style store is keyed by the full path.
 *
 * Resolves with the number of style rows moved.
 */
export const renameCourseStyleTree = async (
  from: string,
  to: string,
): Promise<number> => {
  const source = from.trim();
  const target = to.trim();
  if (!source || !target || source === target) {
    return 0;
  }
  const styles = await listCourseStyles();
  const prefix = `${source}/`;
  let moved = 0;
  for (const [key, style] of Object.entries(styles)) {
    if (key !== source && !key.startsWith(prefix)) {
      continue;
    }
    const nextKey =
      key === source ? target : `${target}${key.slice(source.length)}`;
    await set(nextKey, style, styleStore);
    await del(key, styleStore);
    moved++;
  }
  if (moved > 0) {
    emitChange();
  }
  return moved;
};
