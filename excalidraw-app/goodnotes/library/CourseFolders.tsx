/**
 * Course folders: coloured cards above the document grid.
 *
 * Each folder is a real `<button>` (activating it filters the library to that
 * course, `aria-pressed` reflects whether it is the current filter) plus a
 * second, separately labelled `<button>` that opens the customisation popover.
 * The popover also opens on long-press of the card, for touch.
 *
 * Colour is never load-bearing on its own: the swatch sits beside the course
 * name, the accessible name spells the colour out, and the selected folder is
 * additionally marked with a ring and `aria-pressed`.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  COURSE_COLOR_PRESETS,
  COURSE_EMOJI_PRESETS,
  describeColor,
  hexToRgbChannels,
  normalizeHex,
} from "./courses";
import { Icon, ICON_CHEVRON_DOWN, ICON_CLOSE } from "./icons";

import type { CourseStyle } from "./courses";

/** How long a press must last (ms) before it counts as a long-press. */
const LONG_PRESS_MS = 500;

export interface CourseFolder {
  name: string;
  count: number;
  style: CourseStyle;
  /** Documents in this course that are due within the week. */
  dueSoonCount: number;
}

export interface CourseFoldersProps {
  folders: CourseFolder[];
  activeCourse: string | null;
  onOpenCourse: (course: string) => void;
  onSetColor: (course: string, color: string) => void;
  onSetEmoji: (course: string, emoji: string | null) => void;
}

// ---------------------------------------------------------------------------
// customisation popover
// ---------------------------------------------------------------------------

const CustomisePopover = ({
  course,
  style,
  onSetColor,
  onSetEmoji,
  onClose,
}: {
  course: string;
  style: CourseStyle;
  onSetColor: (course: string, color: string) => void;
  onSetEmoji: (course: string, emoji: string | null) => void;
  onClose: () => void;
}) => {
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [hexDraft, setHexDraft] = useState(style.color);
  const [hexError, setHexError] = useState(false);

  useEffect(() => {
    setHexDraft(style.color);
    setHexError(false);
  }, [style.color]);

  // focus the first control so keyboard users land inside the popover
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);

  useEffect(() => {
    const onDocPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
    };
  }, [onClose]);

  const commitHex = useCallback(() => {
    const hex = normalizeHex(hexDraft);
    if (!hex) {
      setHexError(true);
      return;
    }
    setHexError(false);
    onSetColor(course, hex);
  }, [course, hexDraft, onSetColor]);

  return (
    <div
      className="gn-folder__popover"
      ref={rootRef}
      role="dialog"
      aria-label={`Customise ${course}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="gn-folder__popover-head">
        <h3 className="gn-folder__popover-title">{course}</h3>
        <button
          type="button"
          className="gn-icon-button"
          aria-label={`Close customisation for ${course}`}
          onClick={onClose}
        >
          <Icon path={ICON_CLOSE} />
        </button>
      </div>

      <div className="gn-field">
        <span className="gn-field__label" id={`${id}-colour`}>
          Folder colour
        </span>
        <div className="gn-swatches" role="group" aria-labelledby={`${id}-colour`}>
          {COURSE_COLOR_PRESETS.map((preset) => {
            const selected = preset.value === normalizeHex(style.color);
            return (
              <button
                key={preset.value}
                type="button"
                className={`gn-swatch${selected ? " gn-swatch--selected" : ""}`}
                style={
                  {
                    "--gn-course-rgb": hexToRgbChannels(preset.value),
                  } as React.CSSProperties
                }
                aria-pressed={selected}
                aria-label={preset.label}
                onClick={() => onSetColor(course, preset.value)}
              >
                {selected && <span className="gn-swatch__tick" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="gn-field">
        <label className="gn-field__label" htmlFor={`${id}-hex`}>
          Hex colour
        </label>
        <div className="gn-folder__hex">
          <input
            id={`${id}-hex`}
            className="gn-input"
            type="text"
            inputMode="text"
            spellCheck={false}
            value={hexDraft}
            aria-invalid={hexError || undefined}
            aria-describedby={hexError ? `${id}-hex-error` : undefined}
            placeholder="#4b6bfb"
            onChange={(event) => {
              setHexDraft(event.target.value);
              setHexError(false);
            }}
            onBlur={() => {
              if (normalizeHex(hexDraft)) {
                commitHex();
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitHex();
              }
            }}
          />
          <button
            type="button"
            className="gn-button"
            aria-label={`Apply hex colour to ${course}`}
            onClick={commitHex}
          >
            Apply
          </button>
        </div>
        {hexError && (
          <p className="gn-folder__error" id={`${id}-hex-error`} role="alert">
            Enter a colour like #4b6bfb.
          </p>
        )}
      </div>

      <div className="gn-field">
        <span className="gn-field__label" id={`${id}-emoji`}>
          Folder icon
        </span>
        <div className="gn-emoji-grid" role="group" aria-labelledby={`${id}-emoji`}>
          <button
            type="button"
            className={`gn-emoji${!style.emoji ? " gn-emoji--selected" : ""}`}
            aria-pressed={!style.emoji}
            aria-label="No icon"
            onClick={() => onSetEmoji(course, null)}
          >
            <span aria-hidden="true">—</span>
          </button>
          {COURSE_EMOJI_PRESETS.map((emoji) => {
            const selected = style.emoji === emoji;
            return (
              <button
                key={emoji}
                type="button"
                className={`gn-emoji${selected ? " gn-emoji--selected" : ""}`}
                aria-pressed={selected}
                aria-label={`Icon ${emoji}`}
                onClick={() => onSetEmoji(course, emoji)}
              >
                <span aria-hidden="true">{emoji}</span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="gn-sr-only" role="status" aria-live="polite">
        {`${course} folder is ${describeColor(style.color)}${
          style.emoji ? ` with icon ${style.emoji}` : ""
        }`}
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// one folder card
// ---------------------------------------------------------------------------

const FolderCard = ({
  folder,
  isActive,
  onOpenCourse,
  onSetColor,
  onSetEmoji,
}: {
  folder: CourseFolder;
  isActive: boolean;
  onOpenCourse: (course: string) => void;
  onSetColor: (course: string, color: string) => void;
  onSetEmoji: (course: string, emoji: string | null) => void;
}) => {
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  const countLabel = `${folder.count} ${
    folder.count === 1 ? "document" : "documents"
  }`;

  return (
    <li className="gn-folder-wrapper">
      <div
        className={`gn-folder${isActive ? " gn-folder--active" : ""}`}
        style={
          {
            "--gn-course-rgb": hexToRgbChannels(folder.style.color),
          } as React.CSSProperties
        }
      >
        <button
          type="button"
          className="gn-folder__open"
          aria-pressed={isActive}
          aria-label={`${folder.name}, ${countLabel}, ${describeColor(
            folder.style.color,
          )} folder${
            folder.dueSoonCount > 0
              ? `, ${folder.dueSoonCount} due this week`
              : ""
          }`}
          onClick={() => {
            if (longPressedRef.current) {
              longPressedRef.current = false;
              return;
            }
            onOpenCourse(folder.name);
          }}
          onPointerDown={() => {
            longPressedRef.current = false;
            cancelLongPress();
            longPressRef.current = setTimeout(() => {
              longPressedRef.current = true;
              setOpen(true);
            }, LONG_PRESS_MS);
          }}
          onPointerUp={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onPointerCancel={cancelLongPress}
        >
          <span className="gn-folder__glyph" aria-hidden="true">
            {folder.style.emoji ?? folder.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="gn-folder__text">
            <span className="gn-folder__name">{folder.name}</span>
            <span className="gn-folder__count">{countLabel}</span>
          </span>
        </button>

        <button
          type="button"
          className="gn-icon-button gn-folder__menu"
          ref={menuButtonRef}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`Customise ${folder.name} folder`}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon path={ICON_CHEVRON_DOWN} />
        </button>

        {open && (
          <CustomisePopover
            course={folder.name}
            style={folder.style}
            onSetColor={onSetColor}
            onSetEmoji={onSetEmoji}
            onClose={close}
          />
        )}
      </div>
    </li>
  );
};

export const CourseFolders = ({
  folders,
  activeCourse,
  onOpenCourse,
  onSetColor,
  onSetEmoji,
}: CourseFoldersProps) => {
  if (folders.length === 0) {
    return null;
  }
  return (
    <section className="gn-folders" aria-labelledby="gn-folders-heading">
      <h2 className="gn-folders__heading" id="gn-folders-heading">
        Courses
      </h2>
      <ul className="gn-folders__list">
        {folders.map((folder) => (
          <FolderCard
            key={folder.name}
            folder={folder}
            isActive={folder.name === activeCourse}
            onOpenCourse={onOpenCourse}
            onSetColor={onSetColor}
            onSetEmoji={onSetEmoji}
          />
        ))}
      </ul>
    </section>
  );
};

export default CourseFolders;
