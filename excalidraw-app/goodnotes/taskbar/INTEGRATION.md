# `goodnotes/taskbar` — superseded by `goodnotes/shell`

The single centred taskbar this folder used to export has been replaced by the three-zone navigation bar in [`../shell`](../shell/INTEGRATION.md). Follow that file for the `App.tsx` changes.

## What is left here (and still maintained)

| File | Role |
| --- | --- |
| `tools.ts` | The only place the chrome talks to `ExcalidrawImperativeAPI`: tool activation, ink presets, the highlighter `customData` marker, which tools persist after one use (`PERSISTENT_TOOLS`), and the reverse mapping from `appState` back onto a slot. |
| `model.ts` | The declarative control model and the pure overflow solver (`planOverflow`). |
| `icons.tsx` | The inline icon set. |
| `Menu.tsx` / `Menu.scss` | The shared popover used by Shapes, the centre overflow and the right-zone "…". |

`Taskbar.tsx` and `Taskbar.scss` are gone.

## Compatibility

`index.ts` still exports `Taskbar` and `SUPPRESS_DEFAULT_TOOLBAR_CLASS`:

```ts
export { NavBar as Taskbar } from "../shell/NavBar";
export { SUPPRESS_DEFAULT_CHROME_CLASS as SUPPRESS_DEFAULT_TOOLBAR_CLASS } from "../shell/NavBar";
```

So the existing `App.tsx` line

```ts
import { Taskbar } from "./goodnotes/taskbar";
```

keeps compiling and renders the new bar — as a floating, viewport-fixed bar (`placement="fixed"`, the legacy default; `NavBar`'s own default is `"flow"`, a band in the host's layout) and with the left zone empty until you pass its callbacks. The alias is deprecated: migrate the call site to `NavBar` + `PagePanel` as described in `../shell/INTEGRATION.md`, after which nothing should import `Taskbar` any more.
