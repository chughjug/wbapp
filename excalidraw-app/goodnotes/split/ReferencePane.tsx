/**
 * The reference pane: another notebook open beside the one you are
 * writing in.
 *
 * Read-only by design — see `renderReference.ts` for why pages are
 * rasterised rather than hosted in a second editor.
 *
 * Pages load as they come into view, through an `IntersectionObserver`
 * against the pane's own scroller. A fifty-page PDF notebook would
 * otherwise rasterise fifty A4 canvases on open, which on a tablet is
 * both a long freeze and a lot of memory for pages nobody scrolled to.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";

import { loadReference } from "./renderReference";

import "./ReferencePane.scss";

import type { ReferenceDocument } from "./renderReference";

export interface ReferencePaneProps {
  docId: string;
  title: string;
  onClose: () => void;
  /** Vertical or horizontal split, decided by the host from its width. */
  orientation: "side-by-side" | "stacked";
  theme?: "light" | "dark";
  /** Host-supplied flex sizing; the split fraction lives with the host. */
  style?: React.CSSProperties;
}

interface PageSlotProps {
  index: number;
  reference: ReferenceDocument;
  root: HTMLElement | null;
}

/**
 * One page: a placeholder until it scrolls near, then an image.
 *
 * The rasterised canvas is encoded to a blob and shown as an `<img>`,
 * rather than the canvas element being inserted into the DOM. That is how
 * `export/PagePreview` already does it, and the reason matters: putting a
 * live canvas node inside a React-managed element means React and this
 * component both own the same children, and the tree blew up on the first
 * reconcile after a page rendered. An `<img>` is ordinary React output,
 * and it also lets the browser drop the decoded pixels of pages that have
 * scrolled far away.
 */
const PageSlot: React.FC<PageSlotProps> = ({ index, reference, root }) => {
  const holderRef = useRef<HTMLLIElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || url) {
      return;
    }
    let cancelled = false;
    let made: string | null = null;
    // The URL is revoked by the *unmount* cleanup below, never by a
    // re-run: this effect lists `url` among its dependencies, so calling
    // `setUrl` re-runs it, and revoking in that cleanup destroyed the
    // blob the `<img>` had just been pointed at — a broken-image icon in
    // place of every page.
    let keepAlive = false;

    const draw = async () => {
      try {
        const canvas = await reference.renderPage(index);
        if (cancelled || !canvas) {
          return;
        }
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        if (cancelled || !blob) {
          return;
        }
        made = URL.createObjectURL(blob);
        keepAlive = true;
        setUrl(made);
      } catch {
        // one page that will not draw must not take the pane with it
      }
    };

    if (typeof IntersectionObserver === "undefined") {
      void draw();
      return () => {
        cancelled = true;
        if (made && !keepAlive) {
          URL.revokeObjectURL(made);
        }
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void draw();
        }
      },
      // a screen of lead-in, so a page is ready by the time it arrives
      { root: root ?? null, rootMargin: "100% 0px" },
    );
    observer.observe(holder);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (made && !keepAlive) {
        URL.revokeObjectURL(made);
      }
    };
  }, [index, reference, root, url]);

  // Release the live blob when the page slot itself unmounts (the pane
  // closed, or a different reference was opened).
  useEffect(
    () => () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    },
    [url],
  );

  return (
    <li className="gn-ref__page" ref={holderRef}>
      <div className="gn-ref__holder">
        {url ? (
          <img
            className="gn-ref__canvas"
            src={url}
            alt={`Page ${index + 1}`}
            loading="lazy"
          />
        ) : (
          <div className="gn-ref__skeleton" />
        )}
      </div>
      <span className="gn-ref__pagenum">{index + 1}</span>
    </li>
  );
};

export const ReferencePane: React.FC<ReferencePaneProps> = ({
  docId,
  title,
  onClose,
  orientation,
  theme,
  style,
}) => {
  const [reference, setReference] = useState<ReferenceDocument | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">(
    "loading",
  );
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const headingId = useId();

  const attachScroller = useCallback((node: HTMLDivElement | null) => {
    scrollerRef.current = node;
    setScroller(node);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setReference(null);
    loadReference(docId)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        if (!loaded) {
          setStatus("empty");
          return;
        }
        setReference(loaded);
        setStatus(loaded.pageCount === 0 ? "empty" : "ready");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  return (
    <aside
      className={`gn-ref gn-ref--${orientation} excalidraw${
        theme === "dark" ? " theme--dark" : ""
      }`}
      style={style}
      aria-labelledby={headingId}
    >
      <header className="gn-ref__head">
        <h2 className="gn-ref__title" id={headingId} title={title}>
          {title}
        </h2>
        <span className="gn-ref__badge">Reference</span>
        <button
          type="button"
          className="gn-ref__close"
          onClick={onClose}
          aria-label={`Close the reference pane showing ${title}`}
        >
          ×
        </button>
      </header>

      <div className="gn-ref__scroll" ref={attachScroller}>
        {status === "loading" && (
          <p className="gn-ref__note">Opening {title}…</p>
        )}
        {status === "empty" && (
          <p className="gn-ref__note">
            This notebook has no pages yet, so there is nothing to show
            alongside.
          </p>
        )}
        {status === "error" && (
          <p className="gn-ref__note" role="alert">
            That notebook could not be opened for reference.
          </p>
        )}
        {status === "ready" && reference && (
          <ol className="gn-ref__pages">
            {Array.from({ length: reference.pageCount }, (_, index) => (
              <PageSlot
                key={index}
                index={index}
                reference={reference}
                root={scroller}
              />
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
};
