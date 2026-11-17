# goodnotes/present — page presentation mode

AFFiNE/BlockSuite-inspired walk through existing page frames.

```tsx
const presentation = usePresentation(excalidrawAPI, pages);

// FloatingBar more menu:
{ id: "present", label: "Present pages", onSelect: () => presentation.start() }

<PresentationOverlay
  active={presentation.active}
  index={presentation.index}
  pageCount={pages.length}
  onPrev={presentation.prev}
  onNext={presentation.next}
  onExit={presentation.stop}
/>
```

Keys: ←/→ or PageUp/PageDown, Escape to exit. Fullscreen is best-effort.
