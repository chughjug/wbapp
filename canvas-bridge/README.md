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

**Production host:** the relay is also mounted on the ratings Heroku app at

`https://chess-tournament-director-6ce5e76147d7.herokuapp.com/api/canvas-bridge`

Set that (or your own deploy) as `VITE_CANVAS_BRIDGE_URL` in the wbapp build.

## Extension

Load the `chrome-extension/` folder unpacked in `chrome://extensions` (it contains `manifest.json`). Set the bridge URL in the popup to your Heroku app. Keep a Canvas tab open while syncing.

## API sketch

| Method | Path                                 | Who                          |
| ------ | ------------------------------------ | ---------------------------- |
| POST   | `/v1/rooms`                          | Extension — create pair room |
| POST   | `/v1/rooms/join`                     | iPad — `{ pairCode }`        |
| POST   | `/v1/rooms/:id/jobs`                 | iPad — `{ courseId? }`       |
| GET    | `/v1/rooms/:id/jobs/:jobId`          | iPad — poll until `ready`    |
| GET    | `/v1/rooms/:id/jobs/waiting`         | Extension                    |
| POST   | `/v1/rooms/:id/jobs/:jobId/complete` | Extension — upload payload   |

Single-dyno in-memory store (12h rooms, 30m jobs). For multi-dyno, replace `store.js` with Redis.
