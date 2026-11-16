/**
 * <NewPageDialog /> — choose the format of a new page before it is created.
 *
 * Three decisions, remembered per document (see `./newPageChoice`):
 *   1. format — the six paper templates plus **Image**, in ONE radiogroup
 *      built from `../paper`'s `PaperPicker` (previews come from the real
 *      template renderers, so they can never drift),
 *   2. page size — Letter / A4 / Legal,
 *   3. orientation — portrait / landscape.
 *
 * Accessibility:
 *  - `role="dialog" aria-modal="true"`, labelled by its title and described
 *    by its intro line; focus moves in on mount, is trapped with
 *    Tab/Shift+Tab and restored on close; Escape and backdrop click close.
 *  - Every group is a real `radiogroup` of `role="radio"` controls with
 *    accessible names and roving tabindex + arrow-key navigation.
 *  - The image case uses a real `<input type="file">` with a real `<label>`;
 *    the chosen file is announced through `aria-live="polite"` and errors
 *    through `role="alert"`.
 *  - Focus rings are `:focus-visible` and never removed; all motion is
 *    disabled under `prefers-reduced-motion: reduce`.
 *  - Colours come from Excalidraw's own theme custom properties, so the
 *    dialog is correct in light and dark. (`--color-muted` is a *background*
 *    grey in that palette and is never used for text here.)
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { PAPER_TEMPLATE_LIST, PaperPicker, PaperPreview } from "../paper";

import { PAGE_SIZES } from "../types";

import {
  PAGE_IMAGE_ACCEPT,
  PageImageError,
  isSupportedPageImage,
} from "./pageImageFile";

import "./NewPageDialog.scss";

import type { PaperPickerOption } from "../paper";
import type { PageImageFit } from "../paper/pageImages";
import type { NewPageChoice } from "./newPageChoice";
import type { PageSizeName, PaperTemplateId } from "../types";

/**
 * The id space of the format radiogroup. `PaperTemplateId` is owned by
 * `../types` and we must not add to it, so the extra member lives here, in
 * OUR module, and is translated back into a real `PaperTemplateId` plus an
 * image record before anything touches the scene.
 */
export const IMAGE_FORMAT_ID = "__image__";
export type NewPageFormatId = PaperTemplateId | typeof IMAGE_FORMAT_ID;

/** What the dialog hands back when the user confirms. */
export interface NewPageSubmission {
  /** Always a real `PaperTemplateId` — `"blank"` for an image page. */
  template: PaperTemplateId;
  size: PageSizeName;
  landscape: boolean;
  /** The picked file, when the user chose the Image format. */
  imageFile: File | null;
  imageFit: PageImageFit;
}

export interface NewPageDialogProps {
  /** Initial selection — normally the remembered choice for this document. */
  initial?: Partial<NewPageChoice>;
  /** Confirm. May be async; the dialog shows a busy state until it settles. */
  onSubmit: (submission: NewPageSubmission) => void | Promise<void>;
  /** Escape, backdrop, Cancel, or after a successful submit. */
  onClose: () => void;
  /** Dialog theme. Default `"light"`. */
  theme?: "light" | "dark";
  /** Heading. Default `"New page"`. */
  title?: string;
  /** Confirm button label. Default `"Add page"`. */
  submitLabel?: string;
  className?: string;
}

const SIZE_ORDER: PageSizeName[] = ["LETTER", "A4", "LEGAL"];
const SIZE_LABELS: Record<PageSizeName, string> = {
  LETTER: "Letter",
  A4: "A4",
  LEGAL: "Legal",
};

const FIT_OPTIONS: { id: PageImageFit; label: string; hint: string }[] = [
  { id: "cover", label: "Fill", hint: "Crop to fill the whole page" },
  { id: "contain", label: "Fit", hint: "Show the whole image, with margins" },
  { id: "stretch", label: "Stretch", hint: "Distort to the exact page box" },
];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Minimal roving-tabindex radiogroup, used for size and orientation. */
const RadioRow = <T extends string>({
  value,
  options,
  onChange,
  label,
  name,
  disabled,
}: {
  value: T;
  options: readonly { id: T; label: string; hint?: string }[];
  onChange: (id: T) => void;
  label: string;
  name: string;
  disabled?: boolean;
}) => {
  const labelId = `${name}-label`;
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, id: T) => {
    const index = options.findIndex((option) => option.id === id);
    let next = -1;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (index + 1) % options.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (index - 1 + options.length) % options.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = options.length - 1;
        break;
      case " ":
      case "Enter":
        event.preventDefault();
        onChange(id);
        return;
      default:
        return;
    }
    event.preventDefault();
    const target = options[next].id;
    onChange(target);
    refs.current.get(target)?.focus();
  };

  return (
    <div className="gn-new-page__field">
      <div className="gn-new-page__field-label" id={labelId}>
        {label}
      </div>
      <div
        className="gn-new-page__radio-row"
        role="radiogroup"
        aria-labelledby={labelId}
      >
        {options.map((option) => {
          const checked = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={
                option.hint ? `${option.label} — ${option.hint}` : option.label
              }
              disabled={disabled}
              tabIndex={checked ? 0 : -1}
              ref={(node) => {
                if (node) {
                  refs.current.set(option.id, node);
                } else {
                  refs.current.delete(option.id);
                }
              }}
              className={`gn-new-page__radio${
                checked ? " gn-new-page__radio--selected" : ""
              }`}
              onClick={() => onChange(option.id)}
              onKeyDown={(event) => onKeyDown(event, option.id)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/** Swatch for the "Image" format option: the picked file, or a photo glyph. */
const ImageFormatPreview = ({
  url,
  theme,
}: {
  url: string | null;
  theme: "light" | "dark";
}) => (
  <span className="gn-new-page__image-swatch" data-theme={theme}>
    {url ? (
      <img src={url} alt="" draggable={false} />
    ) : (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect
          x="3"
          y="5"
          width="18"
          height="14"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <circle cx="9" cy="10" r="1.6" fill="currentColor" />
        <path
          d="M4.5 17.5 L10 12 L13.5 15.5 L16 13 L19.5 16.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )}
  </span>
);

export const NewPageDialog: React.FC<NewPageDialogProps> = ({
  initial,
  onSubmit,
  onClose,
  theme = "light",
  title = "New page",
  submitLabel = "Add page",
  className,
}) => {
  const uid = useId().replace(/:/g, "");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  const [format, setFormat] = useState<NewPageFormatId>(
    initial?.image ? IMAGE_FORMAT_ID : initial?.template ?? "lined",
  );
  const [size, setSize] = useState<PageSizeName>(initial?.size ?? "A4");
  const [landscape, setLandscape] = useState<boolean>(
    initial?.landscape ?? false,
  );
  const [imageFit, setImageFit] = useState<PageImageFit>(
    initial?.imageFit ?? "cover",
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isImage = format === IMAGE_FORMAT_ID;
  const titleId = `gn-new-page-title-${uid}`;
  const descId = `gn-new-page-desc-${uid}`;
  const errorId = `gn-new-page-error-${uid}`;
  const fileStatusId = `gn-new-page-file-${uid}`;

  // object URL for the chosen file's swatch, revoked on change/unmount
  useEffect(() => {
    if (!imageFile || typeof URL === "undefined" || !URL.createObjectURL) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  // focus in on mount, restore on unmount
  useEffect(() => {
    restoreFocusRef.current = document.activeElement;
    const node = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    node?.focus();
    return () => {
      (restoreFocusRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const nodes = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
      ].filter(
        (node) => node.offsetParent !== null || node === document.activeElement,
      );
      if (nodes.length === 0) {
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const pickFile = useCallback((file: File | null) => {
    setError(null);
    if (!file) {
      setImageFile(null);
      return;
    }
    if (!isSupportedPageImage(file)) {
      setImageFile(null);
      setError(
        `"${file.name}" is not an image we can use. Try a PNG, JPEG, WebP, GIF or SVG.`,
      );
      return;
    }
    setImageFile(file);
  }, []);

  const formatOptions = useMemo<PaperPickerOption<NewPageFormatId>[]>(
    () => [
      ...PAPER_TEMPLATE_LIST.map((template) => ({
        id: template.id as NewPageFormatId,
        label: template.label,
        preview: (
          <PaperPreview template={template.id} theme={theme} />
        ) as React.ReactNode,
      })),
      {
        id: IMAGE_FORMAT_ID,
        label: "Image",
        ariaLabel: "Image — use a picture as the page background",
        preview: <ImageFormatPreview url={previewUrl} theme={theme} />,
      },
    ],
    [previewUrl, theme],
  );

  const submit = useCallback(async () => {
    if (busy) {
      return;
    }
    if (isImage && !imageFile) {
      setError("Choose an image for this page first.");
      fileInputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        // an image page keeps a REAL template id; `"blank"` means "no ruling
        // on top of the picture". See the module header in
        // ../paper/pageImages.ts for why we cannot say `template: "image"`.
        template: isImage ? "blank" : (format as PaperTemplateId),
        size,
        landscape,
        imageFile: isImage ? imageFile : null,
        imageFit,
      });
      onClose();
    } catch (caught) {
      setBusy(false);
      setError(
        caught instanceof PageImageError || caught instanceof Error
          ? caught.message
          : "Could not add the page.",
      );
    }
  }, [
    busy,
    format,
    imageFile,
    imageFit,
    isImage,
    landscape,
    onClose,
    onSubmit,
    size,
  ]);

  const preset = PAGE_SIZES[size];
  const dims = landscape
    ? `${preset.height} × ${preset.width}`
    : `${preset.width} × ${preset.height}`;

  return createPortal(
    <div
      className={`excalidraw gn-new-page-backdrop theme--${theme}`}
      data-theme={theme}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div
        className={`gn-new-page${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        ref={dialogRef}
        onKeyDown={onKeyDown}
        data-testid="goodnotes-new-page-dialog"
      >
        <div className="gn-new-page__header">
          <h2 className="gn-new-page__title" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            className="gn-new-page__close"
            onClick={onClose}
            disabled={busy}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M6 6 L18 18 M18 6 L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span className="gn-new-page__sr">Close</span>
          </button>
        </div>

        <p className="gn-new-page__desc" id={descId}>
          Pick a format for the new page. Your choice is remembered for this
          notebook.
        </p>

        <PaperPicker<NewPageFormatId>
          value={format}
          onChange={(next) => {
            setFormat(next);
            setError(null);
          }}
          options={formatOptions}
          theme={theme}
          label="Format"
          idPrefix={`gn-new-page-format-${uid}`}
          disabled={busy}
          className="gn-new-page__formats"
        />

        {isImage && (
          <div className="gn-new-page__field gn-new-page__image">
            <label
              className="gn-new-page__field-label"
              htmlFor={`${fileStatusId}-input`}
            >
              Background image
            </label>
            <input
              id={`${fileStatusId}-input`}
              ref={fileInputRef}
              className="gn-new-page__file"
              type="file"
              accept={PAGE_IMAGE_ACCEPT}
              disabled={busy}
              aria-describedby={fileStatusId}
              onChange={(event) =>
                pickFile(event.currentTarget.files?.[0] ?? null)
              }
            />
            <p
              className="gn-new-page__hint"
              id={fileStatusId}
              aria-live="polite"
            >
              {imageFile
                ? `${imageFile.name} — ${Math.max(
                    1,
                    Math.round(imageFile.size / 1024),
                  )} KB`
                : "PNG, JPEG, WebP, GIF or SVG. Stored with the notebook."}
            </p>

            <RadioRow<PageImageFit>
              value={imageFit}
              options={FIT_OPTIONS}
              onChange={setImageFit}
              label="Image placement"
              name={`gn-new-page-fit-${uid}`}
              disabled={busy}
            />
          </div>
        )}

        <RadioRow<PageSizeName>
          value={size}
          options={SIZE_ORDER.map((id) => ({ id, label: SIZE_LABELS[id] }))}
          onChange={setSize}
          label="Page size"
          name={`gn-new-page-size-${uid}`}
          disabled={busy}
        />

        <RadioRow<"portrait" | "landscape">
          value={landscape ? "landscape" : "portrait"}
          options={[
            { id: "portrait", label: "Portrait" },
            { id: "landscape", label: "Landscape" },
          ]}
          onChange={(id) => setLandscape(id === "landscape")}
          label="Orientation"
          name={`gn-new-page-orientation-${uid}`}
          disabled={busy}
        />

        <p className="gn-new-page__hint gn-new-page__dims">{`${dims} px`}</p>

        {error && (
          <p className="gn-new-page__error" id={errorId} role="alert">
            {error}
          </p>
        )}

        <div className="gn-new-page__actions">
          <button
            type="button"
            className="gn-new-page__button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="gn-new-page__button gn-new-page__button--primary"
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Adding…" : submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default NewPageDialog;
