/**
 * <GesturesReference /> — the discoverability fix.
 *
 * A plain, readable list of every gesture and keyboard shortcut the app has,
 * built from {@link REFERENCE_GROUPS}, which is in turn built from
 * `goodnotes/input`'s own constants. Each gesture row shows, live, whether the
 * switch that controls it is currently off — so the reference is also a
 * diagnosis for "why doesn't the two-finger tap work on my tablet".
 *
 * Markup is a definition-ish list of `<h3>` + rows rather than a `<table>`:
 * two of the three columns are prose, and a table would make a screen reader
 * announce "column 2 of 3" in front of every sentence.
 */

import { useMemo } from "react";

import {
  REFERENCE_GROUPS,
  UNDOCUMENTED_GESTURE_SETTINGS,
} from "./gestureList";

import type { ReferenceEntry, ReferenceGroup } from "./gestureList";
import type { InputSettings } from "../input";

export interface GesturesReferenceProps {
  /**
   * Live input settings. Rows whose switch is off are marked "off" — omit to
   * render the reference with no state at all (e.g. in a help page).
   */
  settings?: InputSettings;
  /** Heading level for group titles. Defaults to 3 (sections use 2). */
  headingLevel?: 3 | 4;
  className?: string;
}

/** Renders `Ctrl/Cmd + Shift + Z` as separate <kbd> chips. */
const renderTrigger = (trigger: string) => {
  // a keyboard shortcut is recognised by its separators; prose triggers
  // ("Two fingers, flick sideways") are left as prose
  const isShortcut = /^[\w/+ –-]+$/.test(trigger) && /[+–]|^\w$/.test(trigger);
  if (!isShortcut) {
    return trigger;
  }
  const parts = trigger.split(/\s*\+\s*/);
  return parts.map((part, index) => (
    <span key={part}>
      {index > 0 ? " + " : null}
      <kbd className="gn-settings-kbd">{part}</kbd>
    </span>
  ));
};

const Row = ({
  entry,
  settings,
}: {
  entry: ReferenceEntry;
  settings?: InputSettings;
}) => {
  const isOff =
    !!settings && !!entry.setting && settings[entry.setting] === false;

  return (
    <div className="gn-settings-ref__row">
      <div className="gn-settings-ref__trigger">
        {renderTrigger(entry.trigger)}
        {isOff && (
          <span className="gn-settings-ref__off">
            Off
            <span className="gn-settings-sr"> — turned off in Pen &amp; touch</span>
          </span>
        )}
      </div>
      <div>
        <p className="gn-settings-ref__effect">{entry.effect}</p>
        {entry.alsoBy && (
          <p className="gn-settings-ref__also">Also: {entry.alsoBy}</p>
        )}
      </div>
    </div>
  );
};

const Group = ({
  group,
  settings,
  headingLevel,
}: {
  group: ReferenceGroup;
  settings?: InputSettings;
  headingLevel: 3 | 4;
}) => {
  const Heading = (headingLevel === 3 ? "h3" : "h4") as "h3" | "h4";
  return (
    <section aria-labelledby={`gn-ref-${group.id}`}>
      <Heading className="gn-settings-ref__group-title" id={`gn-ref-${group.id}`}>
        {group.title}
      </Heading>
      <div>
        {group.entries.map((entry) => (
          <Row key={entry.id} entry={entry} settings={settings} />
        ))}
      </div>
    </section>
  );
};

export const GesturesReference = ({
  settings,
  headingLevel = 3,
  className,
}: GesturesReferenceProps) => {
  const groups = useMemo(() => REFERENCE_GROUPS, []);

  return (
    <div className={className}>
      {groups.map((group) => (
        <Group
          key={group.id}
          group={group}
          settings={settings}
          headingLevel={headingLevel}
        />
      ))}
      {UNDOCUMENTED_GESTURE_SETTINGS.length > 0 && (
        // the drift guard firing. Better a visible admission than a list that
        // quietly stopped being complete.
        <p className="gn-settings-ref__also" role="status">
          This list may be out of date: {UNDOCUMENTED_GESTURE_SETTINGS.length}{" "}
          input setting(s) have no entry here (
          {UNDOCUMENTED_GESTURE_SETTINGS.join(", ")}).
        </p>
      )}
    </div>
  );
};
