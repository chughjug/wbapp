/**
 * <SettingsScreen /> — one place for every preference in the app.
 *
 * ## What it is
 *
 * Before this screen, the settings a student might want were in five
 * unrelated places: pen/touch behind an overflow-menu modal, theme as a single
 * cycling menu item, paper only ever chosen while adding a page, view mode as
 * an unlabelled toggle in the page controls, and the rest nowhere at all. This
 * screen aggregates them, and adds the two sections that had no home: the
 * gestures reference and storage/backup.
 *
 * ## What it is NOT
 *
 * It does not own any setting it shows, except the two in `prefs.ts`. Every
 * control here is the *real* control from the module that owns the setting —
 * `InputSettingsPanel` from `goodnotes/input`, `DarkModeToggle` from
 * `goodnotes/dark`, `PaperPicker` from `goodnotes/paper` — wired to that
 * module's own persistence. Flipping a switch here is indistinguishable from
 * flipping it anywhere else, and no state is mirrored.
 *
 * ## Accessibility
 *
 * - One `<h1>` (the dialog's name), one `<h2>` per section, `<h3>` within;
 *   every section is a `<section aria-labelledby>` pointing at its own heading.
 * - Rendered as `role="dialog" aria-modal="true"` with a focus trap and focus
 *   restored to the opener on close (`useFocusTrap`); Escape closes.
 * - Every control is labelled: composed panels bring their own labels, the
 *   screen's own controls have explicit `<label for>`.
 * - The jump links at the top are real buttons that move focus to the section
 *   heading, not anchors that only scroll.
 * - Backup/restore progress is announced through `aria-live` (see
 *   `StorageSection`).
 * - Animations are disabled under `prefers-reduced-motion: reduce`.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { DarkModeToggle, useDarkMode } from "../dark";
import {
  InputSettingsPanel,
  loadInputSettings,
  saveInputSettings,
  subscribeInputSettings,
} from "../input";
import { loadViewMode, saveViewMode, subscribeViewMode } from "../paged";
import { PaperPicker } from "../paper";
import { loadPenPresets, resetPenPresets } from "../pens";

import { GesturesReference } from "./GesturesReference";
import { dismissGesturesHint } from "./firstRun";
import {
  loadDefaultPaper,
  saveDefaultPaper,
  subscribeDefaultPaper,
} from "./prefs";
import { StorageSection } from "./StorageSection";
import { useFocusTrap } from "./useFocusTrap";

import "./SettingsScreen.scss";

import type { InputSettings } from "../input";
import type { ViewMode } from "../paged";
import type { PaperTemplateId } from "../types";

export interface SettingsScreenProps {
  /** Close the screen. Required in `"modal"` presentation. */
  onClose: () => void;
  /** Resolved theme for the panel's own palette. Defaults to `"light"`. */
  theme?: "light" | "dark";
  /**
   * `"modal"` (default) renders a focus-trapped dialog over a backdrop.
   * `"inline"` renders the same content as a plain panel for a host that has
   * its own routing / sheet.
   */
  presentation?: "modal" | "inline";
  /** Scroll (and focus) straight to a section on open. */
  initialSection?: SettingsSectionId;
  /** Called after a restore writes to the library; the host should reload. */
  onRestored?: () => void;
  className?: string;
}

/** Ids of the screen's sections, in display order. */
export const SETTINGS_SECTIONS = [
  "input",
  "appearance",
  "paper",
  "pens",
  "gestures",
  "storage",
] as const;

// written via an alias because the repo's standalone Prettier and its
// eslint-plugin-prettier disagree about parenthesising `typeof X[number]`
type SettingsSections = typeof SETTINGS_SECTIONS;

export type SettingsSectionId = SettingsSections[number];

const SECTION_LABELS: Record<SettingsSectionId, string> = {
  input: "Pen & touch",
  appearance: "Appearance",
  paper: "Paper",
  pens: "Pens",
  gestures: "Gestures & shortcuts",
  storage: "Storage & backup",
};

export const SettingsScreen = ({
  onClose,
  theme = "light",
  presentation = "modal",
  initialSection,
  onRestored,
  className,
}: SettingsScreenProps) => {
  const idPrefix = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isModal = presentation === "modal";

  useFocusTrap(containerRef, isModal);

  // ---- the settings this screen displays, each owned elsewhere -----------

  // goodnotes/input — subscribe to the module, never mirror it
  const [inputSettings, setInputSettings] =
    useState<InputSettings>(loadInputSettings);
  useEffect(() => subscribeInputSettings(setInputSettings), []);

  // goodnotes/dark
  const dark = useDarkMode();

  // goodnotes/paged
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  useEffect(() => subscribeViewMode(setViewMode), []);

  // this module (prefs.ts)
  const [defaultPaper, setDefaultPaper] =
    useState<PaperTemplateId>(loadDefaultPaper);
  useEffect(() => subscribeDefaultPaper(setDefaultPaper), []);

  // goodnotes/pens — only a count and a reset; editing happens in the tray
  const [penCount, setPenCount] = useState(() => loadPenPresets().length);
  const [penStatus, setPenStatus] = useState("");

  // ---- behaviour ---------------------------------------------------------

  const sectionId = useCallback(
    (id: SettingsSectionId) => `${idPrefix}-${id}`,
    [idPrefix],
  );
  const headingId = useCallback(
    (id: SettingsSectionId) => `${idPrefix}-${id}-h`,
    [idPrefix],
  );

  const goToSection = useCallback(
    (id: SettingsSectionId) => {
      const heading = document.getElementById(headingId(id));
      if (!heading) {
        return;
      }
      heading.scrollIntoView({ block: "start" });
      // move focus too, so a keyboard user continues from the section they
      // jumped to rather than from the link they clicked
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    },
    [headingId],
  );

  // opening the screen is how the first-run hint gets answered
  useEffect(() => {
    dismissGesturesHint();
  }, []);

  useEffect(() => {
    if (initialSection) {
      // after the first paint, so the target has a layout box
      const timer = setTimeout(() => goToSection(initialSection), 0);
      return () => clearTimeout(timer);
    }
  }, [initialSection, goToSection]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  // ---- content -----------------------------------------------------------

  const body = (
    <>
      <div className="gn-settings__header">
        <h1 className="gn-settings__title" id={`${idPrefix}-title`}>
          Settings
        </h1>
        <button type="button" className="gn-settings__close" onClick={onClose}>
          Done
        </button>
      </div>

      <nav className="gn-settings__nav" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            className="gn-settings__nav-link"
            onClick={() => goToSection(id)}
          >
            {SECTION_LABELS[id]}
          </button>
        ))}
      </nav>

      <div className="gn-settings__body">
        {/* ---- pen & touch: the module's own panel, verbatim ---- */}
        <section
          className="gn-settings-section"
          id={sectionId("input")}
          aria-labelledby={headingId("input")}
        >
          <h2 className="gn-settings-section__title" id={headingId("input")}>
            Pen &amp; touch
          </h2>
          <p className="gn-settings-section__blurb">
            How the stylus and your fingers behave on the page. Every gesture
            these switches control is listed under Gestures &amp; shortcuts.
          </p>
          <InputSettingsPanel
            className="gn-settings__embedded-input"
            settings={inputSettings}
            theme={theme}
            onChange={(key, value) => {
              // write straight through to goodnotes/input: it persists and
              // notifies, and our subscription brings the value back. No
              // local copy of the switch exists to go stale.
              saveInputSettings({ [key]: value } as Partial<InputSettings>);
            }}
          />
        </section>

        {/* ---- appearance ---- */}
        <section
          className="gn-settings-section"
          id={sectionId("appearance")}
          aria-labelledby={headingId("appearance")}
        >
          <h2
            className="gn-settings-section__title"
            id={headingId("appearance")}
          >
            Appearance
          </h2>
          <p className="gn-settings-section__blurb">
            Light paper, dark paper, or whatever this device is set to.
          </p>

          <div className="gn-settings-field">
            <div className="gn-settings-field__text">
              <span
                className="gn-settings-field__label"
                id={`${idPrefix}-theme-l`}
              >
                Theme
              </span>
              <p className="gn-settings-field__hint">
                Dark mode keeps ink hues; exports are always on white paper.
              </p>
            </div>
            <div className="gn-settings-field__control">
              <DarkModeToggle
                preference={dark.preference}
                onChange={dark.setPreference}
                label="Theme"
              />
            </div>
          </div>

          <div className="gn-settings-field">
            <div className="gn-settings-field__text">
              <label
                className="gn-settings-field__label"
                htmlFor={`${idPrefix}-viewmode`}
              >
                View mode
              </label>
              <p className="gn-settings-field__hint">
                Paged shows one page filling the workspace. Continuous gives you
                the infinite canvas.
              </p>
            </div>
            <div className="gn-settings-field__control">
              <select
                id={`${idPrefix}-viewmode`}
                className="gn-settings-button"
                value={viewMode}
                onChange={(event) =>
                  saveViewMode(event.target.value as ViewMode)
                }
              >
                <option value="paged">Paged — one page at a time</option>
                <option value="continuous">Continuous — infinite canvas</option>
              </select>
            </div>
          </div>
        </section>

        {/* ---- paper ---- */}
        <section
          className="gn-settings-section"
          id={sectionId("paper")}
          aria-labelledby={headingId("paper")}
        >
          <h2 className="gn-settings-section__title" id={headingId("paper")}>
            Paper
          </h2>
          <p className="gn-settings-section__blurb">
            The ruling new pages start with. You can still pick something else
            for an individual page when you add it.
          </p>
          <PaperPicker
            value={defaultPaper}
            onChange={saveDefaultPaper}
            theme={theme}
            label="Default paper for new pages"
            idPrefix={`${idPrefix}-paper`}
          />
        </section>

        {/* ---- pens ---- */}
        <section
          className="gn-settings-section"
          id={sectionId("pens")}
          aria-labelledby={headingId("pens")}
        >
          <h2 className="gn-settings-section__title" id={headingId("pens")}>
            Pens
          </h2>
          <p className="gn-settings-section__blurb">
            Saved pens live in the pen tray, where they are edited — press{" "}
            <kbd className="gn-settings-kbd">1</kbd>–
            <kbd className="gn-settings-kbd">9</kbd> to switch between them.
          </p>
          <div className="gn-settings-field">
            <div className="gn-settings-field__text">
              <span className="gn-settings-field__label">
                {penCount} saved pen{penCount === 1 ? "" : "s"}
              </span>
              <p className="gn-settings-field__hint">
                Resetting restores the four pens the app ships with and discards
                your own.
              </p>
            </div>
            <div className="gn-settings-field__control">
              <button
                type="button"
                className="gn-settings-button is-danger"
                onClick={() => {
                  const next = resetPenPresets();
                  setPenCount(next.length);
                  setPenStatus(`Pens reset to the ${next.length} defaults.`);
                }}
              >
                Reset pens to defaults
              </button>
            </div>
          </div>
          <p
            className="gn-settings-field__hint"
            role="status"
            aria-live="polite"
          >
            {penStatus}
          </p>
        </section>

        {/* ---- gestures & shortcuts: the discoverability fix ---- */}
        <section
          className="gn-settings-section"
          id={sectionId("gestures")}
          aria-labelledby={headingId("gestures")}
        >
          <h2 className="gn-settings-section__title" id={headingId("gestures")}>
            Gestures &amp; shortcuts
          </h2>
          <p className="gn-settings-section__blurb">
            Everything the app responds to. None of it is the only way to do
            anything — each row says what else does the same job — and the
            gestures can be turned off under Pen &amp; touch.
          </p>
          <GesturesReference settings={inputSettings} headingLevel={3} />
        </section>

        {/* ---- storage & backup ---- */}
        <StorageSection
          headingId={headingId("storage")}
          onRestored={onRestored}
        />
      </div>
    </>
  );

  if (!isModal) {
    return (
      <div
        ref={containerRef}
        className={`excalidraw gn-settings is-inline${
          theme === "dark" ? " theme--dark" : ""
        }${className ? ` ${className}` : ""}`}
        onKeyDown={onKeyDown}
      >
        {body}
      </div>
    );
  }

  return (
    <div
      className="gn-settings-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={containerRef}
        className={`excalidraw gn-settings${
          theme === "dark" ? " theme--dark" : ""
        }${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${idPrefix}-title`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {body}
      </div>
    </div>
  );
};
