# wbapp Canvas Bridge (Heroku)

Relay so an **iPad** can request Canvas course data and a **laptop Chrome extension** (logged into Canvas) fulfills it — **no Canvas developer key / access token**.

```
iPad wbapp ──POST job──► Heroku bridge ◄──poll── Chrome extension (Canvas cookies)
                │                                    │
                └──────── GET payload ◄── upload ────┘
```

## Deploy to Heroku

```bash
cd canvas-bridge
heroku create your-wbapp-canvas-bridge
git subtree push --prefix canvas-bridge heroku main
# or: deploy this folder as the app root
heroku open
```

Set the public URL as `VITE_CANVAS_BRIDGE_URL` in the wbapp build (e.g. `https://your-wbapp-canvas-bridge.herokuapp.com`).

## Extension

Load `chrome-extension/canvas-bridge` unpacked in `chrome://extensions`. Set the bridge URL in the popup to your Heroku app. Keep a Canvas tab open while syncing.

## API sketch

| Method | Path | Who |
| --- | --- | --- |
| POST | `/v1/rooms` | Extension — create pair room |
| POST | `/v1/rooms/join` | iPad — `{ pairCode }` |
| POST | `/v1/rooms/:id/jobs` | iPad — `{ courseId? }` |
| GET | `/v1/rooms/:id/jobs/:jobId` | iPad — poll until `ready` |
| GET | `/v1/rooms/:id/jobs/waiting` | Extension |
| POST | `/v1/rooms/:id/jobs/:jobId/complete` | Extension — upload payload |

Single-dyno in-memory store (12h rooms, 30m jobs). For multi-dyno, replace `store.js` with Redis.
