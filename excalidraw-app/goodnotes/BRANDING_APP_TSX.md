# Branding removal: edits required in `excalidraw-app/App.tsx`

`App.tsx` is owned by another agent, so the de-branding pass could not touch it. Everything else (components, `index.html`, PWA manifest, assets) is already done.

Line numbers are from the file as of this writing (commit on `goodnotes-layer`, ~1600 lines); match on the quoted text rather than the numbers.

Until these land, two stub components stay in the tree purely so `App.tsx` keeps compiling:

- `excalidraw-app/components/ExcalidrawPlusPromoBanner.tsx` — now renders `null`.
- `ExportToExcalidrawPlus` in `excalidraw-app/components/ExportToExcalidrawPlus.tsx` — now renders `null` (the `exportToExcalidrawPlus` upload function in the same file is untouched and still works).

---

## 1. Remove the Excalidraw+ promo banner (lines ~1174-1181)

In `renderTopRightUI`, delete:

```tsx
{
  excalidrawAPI?.getEditorInterface().formFactor === "desktop" && (
    <ExcalidrawPlusPromoBanner isSignedIn={isExcalidrawPlusSignedUser} />
  );
}
```

Then delete the import on line 167:

```tsx
import { ExcalidrawPlusPromoBanner } from "./components/ExcalidrawPlusPromoBanner";
```

After this, **delete the file** `excalidraw-app/components/ExcalidrawPlusPromoBanner.tsx` (it has no other importers).

## 2. Remove the "Export to Excalidraw+" card from the export dialog (lines ~1131-1159)

In `UIOptions.canvasActions.export`, drop `renderCustomUI` entirely so the block becomes:

```tsx
        UIOptions={{
          canvasActions: {
            toggleTheme: true,
            export: {
              onExportToBackend,
            },
          },
        }}
```

## 3. Remove the Excalidraw+ entry from the overwrite-confirm dialog (lines ~1219-1236)

Delete the whole `{excalidrawAPI && (<OverwriteConfirmDialog.Action ... />)}` block that uses `t("overwriteConfirm.action.excalidrawPlus.*")`, leaving:

```tsx
<OverwriteConfirmDialog>
  <OverwriteConfirmDialog.Actions.ExportToImage />
  <OverwriteConfirmDialog.Actions.SaveToDisk />
</OverwriteConfirmDialog>
```

## 4. Remove the Excalidraw+ command-palette commands (lines ~1057-1085 and ~1441-1462)

Delete the two command definitions near line 1057:

```tsx
  const ExcalidrawPlusCommand = { ... };
  const ExcalidrawPlusAppCommand = { ... };
```

and, in the `customCommandPaletteItems` array, delete both:

```tsx
            ...(isExcalidrawPlusSignedUser
              ? [
                  {
                    ...ExcalidrawPlusAppCommand,
                    label: "Sign in / Go to Excalidraw+",
                  },
                ]
              : [ExcalidrawPlusCommand, ExcalidrawPlusAppCommand]),
```

and the export command immediately after it:

```tsx
            {
              label: t("overwriteConfirm.action.excalidrawPlus.button"),
              category: DEFAULT_CATEGORIES.export,
              icon: exportToPlus,
              predicate: true,
              keywords: ["plus", "export", "save", "backup"],
              perform: () => {
                if (excalidrawAPI) {
                  exportToExcalidrawPlus(
                    excalidrawAPI.getSceneElements(),
                    excalidrawAPI.getAppState(),
                    excalidrawAPI.getFiles(),
                    excalidrawAPI.getName(),
                  );
                }
              },
            },
```

## 5. Remove the brand social links from the command palette (lines ~1366-1439)

Delete these four command objects (they link to Excalidraw's own channels):

- `label: "GitHub"` → `https://github.com/excalidraw/excalidraw`
- `label: t("labels.followUs")` → `https://x.com/excalidraw`
- `label: t("labels.discordChat")` → `https://discord.gg/UexuTaE`
- `label: "YouTube"` → `https://youtube.com/@excalidraw`

(The equivalent `MainMenu.DefaultItems.Socials` entry has already been removed from `AppMainMenu.tsx`.)

## 6. Clean up the now-unused imports

- Line 43-50 (`./app-jotai` icon re-exports, check the real import source): remove `GithubIcon`, `XBrandIcon`, `DiscordIcon`, `ExcalLogo`, `exportToPlus`, `youtubeIcon`.
- Line 110: remove `isExcalidrawPlusSignedUser` from the `./app_constants` import.
- Lines 123-126: remove the `ExportToExcalidrawPlus` / `exportToExcalidrawPlus` import. Once both are gone, delete `excalidraw-app/components/ExportToExcalidrawPlus.tsx` as well.

## 7. Optional: the Excalidraw+ iframe-export route (line 163 / 1573)

```tsx
import { ExcalidrawPlusIframeExport } from "./ExcalidrawPlusIframeExport";
...
    return <ExcalidrawPlusIframeExport />;
```

This is the `#excalidraw-plus-iframe-export` hash route used by Excalidraw+ to render scenes in an iframe. It is not visible chrome, so it was left alone, but it is dead weight for this product and can be removed together with `excalidraw-app/ExcalidrawPlusIframeExport.tsx`.

---

After applying 1-6, run:

```
npx tsc --noEmit -p tsconfig.json
npx eslint excalidraw-app --ext .ts,.tsx
```
