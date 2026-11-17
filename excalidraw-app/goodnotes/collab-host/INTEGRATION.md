# goodnotes/collab-host

Makes self-hosted [excalidraw-room](https://github.com/excalidraw/excalidraw-room) status visible and mints WBO-style classroom codes.

```tsx
import { CollabHostPanel, getCollabHostStatus } from "./goodnotes/collab-host";

<CollabHostPanel theme={editorTheme} />
```

Set `VITE_APP_WS_SERVER_URL` to your room server. Live sync still goes through existing `Collab.tsx` / socket.io — this panel is configuration UX only.
