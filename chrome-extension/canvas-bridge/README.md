# wbapp Canvas Bridge — Chrome extension

MV3 extension that keeps a pairing room open on the Heroku relay and fulfills
iPad sync jobs using your **logged-in Canvas tab** (cookies). No Canvas access
token or developer key.

## Load unpacked

1. Deploy `canvas-bridge/` to Heroku (or run `npm start` locally on port 8787).
2. Open `chrome://extensions` → Developer mode → **Load unpacked** → select this folder.
3. Open your school Canvas and stay logged in.
4. Click the extension icon — note the **6-character pairing code**.
5. On the iPad, open wbapp → Connect Canvas → **Laptop extension** → enter the code → Sync.

Set the Bridge URL in the popup to your Heroku app (e.g. `https://your-app.herokuapp.com`).

## Permissions

- `tabs` / `scripting` — find the Canvas tab and run authenticated `/api/v1` fetches in-page.
- `storage` / `alarms` — keep the room + poll every few seconds while Chrome is open.
- Host access — school Canvas domains vary; the extension only talks to Canvas via the open tab.
