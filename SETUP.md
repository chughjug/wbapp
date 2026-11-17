# Deploying Notebook (GitHub + Vercel + Supabase)

Claude runs in an isolated cloud container and cannot reach your browser or your accounts, so the steps below are the ones only you can do. Each says exactly what to click and what to paste back.

---

## Tab 1 — GitHub

1. Go to https://github.com/excalidraw/excalidraw and press **Fork** (uncheck "Copy the master branch only" if you want full history).
2. Tell Claude the resulting URL, e.g. `https://github.com/<you>/excalidraw`.

Claude then repoints `origin`, unshallows the clone (it was cloned with `--depth 1`) and pushes the `goodnotes-layer` branch.

Why you have to do this: the container's proxy refuses GitHub write APIs (`HTTP 403: Write access to this GitHub API path is not permitted through this proxy`), so `gh repo fork` cannot run here.

---

## Tab 2 — Supabase

1. **New project** (any name; pick a region near you). Save the database password somewhere.
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` from this repo → **Run**. That creates the `documents` table, row level security, the `scenes` and `files` storage buckets and their policies.
3. **Authentication → Providers** → enable **Email** (magic link is the least friction for students). Optionally enable Google.
4. **Project Settings → API** → copy these two values and send them to Claude, or set them yourself in Tab 3:
   - Project URL → `VITE_SUPABASE_URL`
   - `anon` `public` key → `VITE_SUPABASE_ANON_KEY`

The `anon` key is designed to be public and ships in the client bundle. What protects your data is the row level security in the schema, not the secrecy of that key. Never put the `service_role` key in this app.

---

## Tab 3 — Vercel

1. **Add New → Project** → import the fork from Tab 1.
2. Vercel reads `vercel.json`, which is already set up:
   - Output directory `excalidraw-app/build`
   - Install command `yarn install`
   - An SPA rewrite so `/d/<docId>` document links survive a refresh
3. **Settings → Environment Variables**, add:

   | Name                      | Value                                     |
   | ------------------------- | ----------------------------------------- |
   | `VITE_SUPABASE_URL`       | from Supabase Tab 2                       |
   | `VITE_SUPABASE_ANON_KEY`  | from Supabase Tab 2                       |
   | `VITE_APP_WS_SERVER_URL`  | leave empty to disable live collaboration |
   | `VITE_APP_DISABLE_SENTRY` | `true`                                    |

4. **Deploy.**

### Before the first deploy succeeds

`yarn build` runs a typecheck and fails the whole build on any type error, even though Vite itself emits output. Agent harness files have been failing it; Claude verifies the build is clean before you deploy.

---

## Still pointing at Excalidraw's infrastructure

`.env.production` currently sends collaboration, shareable links, the font/library service and AI requests to Excalidraw's own servers, using their Firebase credentials. Fine locally, not fine for a public deployment. Override per service in Vercel, or run your own.

---

## Self-host live collaboration (excalidraw-room)

1. Deploy [excalidraw/excalidraw-room](https://github.com/excalidraw/excalidraw-room) (or a compatible socket.io room server).
2. In Vercel / `.env.local` set:

   | Name | Value |
   | --- | --- |
   | `VITE_APP_WS_SERVER_URL` | `https://your-room-server.example` |

3. Open **Settings → Collaboration** in the app: you should see the server URL and can mint classroom room codes.

Offline version history uses **Yjs + IndexedDB** locally (`goodnotes/crdt`) and does not require the room server.
