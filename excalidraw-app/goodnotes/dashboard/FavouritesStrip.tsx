/**
 * The pinned row: the two or three notebooks you are actually living in.
 *
 * Favourites already existed — a reserved `favourite` tag, a star on the
 * card, a filter chip, a bulk toggle in the selection bar. What they did
 * not have was a way to *reach* them without first clicking a filter, which
 * is the whole point of marking something a favourite. On a term's worth of
 * notebooks that is a click, a repaint and a scan every single time you open
 * the app to carry on with the thing you were already working on.
 *
 * So the dashboard shows them at the top. Ordered by most recently opened
 * rather than alphabetically or by when they were starred: of four pinned
 * notebooks, the one you want is almost always the one you had open last.
 *
 * Renders nothing at all when nothing is pinned — no empty state, no "star
 * a notebook to see it here" nudge. The star is discoverable on the card
 * and in the selection bar; a permanent band of instructions for a feature
 * you are not using is the kind of chrome this app has been stripping out
 * all along.
 */

import React from "react";

import { hueFromId } from "../library";

import type { CourseStyle } from "../library";
import type { DocMeta } from "../types";

/** Most that fit before the row stops being a glance and becomes a list. */
export const MAX_FAVOURITES_SHOWN = 6;

export interface FavouritesStripProps {
  /** Starred documents, already filtered to live (non-trashed) ones. */
  items: readonly DocMeta[];
  styleOf: (course: string) => CourseStyle;
  onOpenDocument: (doc: DocMeta) => void;
  /** Heading id, so the section can be labelled by it. */
  headingId: string;
}

/**
 * Starred documents in the order the row shows them: most recently opened
 * first, falling back to last edited for one never opened since it was
 * starred.
 */
export const orderFavourites = (
  docs: readonly DocMeta[],
  limit: number = MAX_FAVOURITES_SHOWN,
): DocMeta[] =>
  [...docs]
    .sort(
      (a, b) =>
        (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt),
    )
    .slice(0, limit);

export const FavouritesStrip = ({
  items,
  styleOf,
  onOpenDocument,
  headingId,
}: FavouritesStripProps) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="gn-favourites" aria-labelledby={headingId}>
      <h2 className="gn-favourites__heading" id={headingId}>
        Favourites
      </h2>
      <ul className="gn-favourites__list">
        {items.map((doc) => {
          const course = doc.course ? styleOf(doc.course) : null;
          return (
            <li key={doc.id}>
              <button
                type="button"
                className="gn-favourites__item"
                style={
                  { "--gn-hue": `${hueFromId(doc.id)}` } as React.CSSProperties
                }
                aria-label={`Open ${doc.title}${
                  doc.course ? `, ${doc.course}` : ""
                }`}
                onClick={() => onOpenDocument(doc)}
              >
                <span className="gn-favourites__star" aria-hidden="true">
                  ★
                </span>
                <span className="gn-favourites__text">
                  <span className="gn-favourites__title">{doc.title}</span>
                  {doc.course && (
                    <span className="gn-favourites__course">
                      <span
                        className="gn-favourites__dot"
                        aria-hidden="true"
                        style={
                          course
                            ? ({
                                background: course.color,
                              } as React.CSSProperties)
                            : undefined
                        }
                      />
                      {doc.course}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
