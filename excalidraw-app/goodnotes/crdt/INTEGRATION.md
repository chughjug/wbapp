# goodnotes/crdt — Yjs + IndexedDB

Adds a **local CRDT history / role store** beside Excalidraw’s socket collab and Supabase sync. It does **not** replace live E2EE collaboration.

## Dependencies

`yjs` and `y-indexeddb` (already listed in `excalidraw-app/package.json`).

## App wiring

```tsx
import { HistoryPanel, useCrdtDoc } from "./goodnotes/crdt";

const crdt = useCrdtDoc(docId);

// pass into Settings via useSettingsScreen({ extraSections: … })
<HistoryPanel
  ready={crdt.ready}
  role={crdt.role}
  snapshots={crdt.snapshots}
  onRoleChange={crdt.setDocRole}
  onSaveSnapshot={() => {
    /* serialize scene → crdt.saveSnapshot */
  }}
/>;
```

Self-host live rooms still use `VITE_APP_WS_SERVER_URL` → [excalidraw-room](https://github.com/excalidraw/excalidraw-room).
