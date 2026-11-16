# Integrating `goodnotes/sync`

Everything below lives in `excalidraw-app/goodnotes/sync/`, plus one file you already have: `supabase/schema.sql`.

Adopting it is **two calls in `App.tsx`** and, if you want the sign-in form inside Settings, three lines in `goodnotes/settings/SettingsScreen.tsx` (which you own). With no env vars set, adopting it changes nothing the user can see — the panel renders `null` and the module makes no network calls at all.

---

## 1. What this module does

Notebooks live in IndexedDB. Clear site data and they are gone; open the app on a second device and they are not there; and Safari caps script-writable storage at seven days for sites that are not on the Home Screen. This module copies each notebook to Supabase and back.

It is **local-first and strictly additive**. The library (`goodnotes/library`) stays the single source of truth for the running app: the editor reads and writes IndexedDB exactly as it does now, and sync runs behind it. Signed out, offline, or unconfigured, the app behaves exactly as it does today.

Layout on the server:

| Where | What |
| --- | --- |
| `documents` table | one row per notebook: title, course, due date, tags, thumbnail, version |
| `scenes` bucket, `<uid>/<docId>/scene.json` | elements + appState + the ids of attached files |
| `files` bucket, `<uid>/<fileId>.json` | one imported image or PDF page, content-addressed |

Binary files are kept out of the scene blob on purpose: a file id is derived from the bytes, so a file is uploaded once and never rewritten. One ink stroke on a notebook holding a 20 MB imported PDF is a ~40 kB upload, not a 20 MB one.

---

## 2. Env vars

```bash
# excalidraw-app/.env.local, and the Vercel project's environment variables
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<the anon / publishable key>
```

Both are **public by design**: every `VITE_`-prefixed variable is inlined into the client bundle, and the anon key is a JWT whose only privilege is "act as an anonymous or signed-in user". Row Level Security is what actually separates users.

**The `service_role` key must never be set here, anywhere, under any name.** It bypasses RLS entirely. `config.ts` decodes the anon key's payload at startup and, if it sees `service_role`, refuses to start sync and says so — but that is a seatbelt, not a permission slip.

With neither variable set the module is inert: `isSyncConfigured()` is `false`, `getClient()` resolves to `null`, `@supabase/supabase-js` is never fetched (it is behind a dynamic `import()`), and `<SyncPanel />` renders nothing.

No new types were added to `goodnotes/types.ts` and none are needed.

---

## 3. `App.tsx` — the exact change

Two imports:

```tsx
import { SyncPanel, useSync } from "./goodnotes/sync";
```

Then inside `GoodNotesRoot`, directly after the `useDarkMode()` line:

```tsx
const { editorTheme } = useDarkMode();
const canvasConnect = useCanvasConnect({ theme: editorTheme });

// Sync lives here, above both the shelf and the editor, so a pass is not
// cancelled by navigating between them. `activeDocId` is load-bearing:
// the engine will not overwrite the document the editor currently holds
// in memory (see §6).
const sync = useSync({ activeDocId: docId });
```

`GoodNotesRoot` has several `return`s. Add the panel to whichever surface you want it on; the simplest honest placement is the dashboard, where a student who has never signed in can see that their notebooks are device-only:

```tsx
if (!docId && !isTransientScene) {
  return (
    <>
      <Dashboard
        theme={editorTheme}
        onOpenDocument={openDocument}
        headerExtra={
          <>
            <PdfDropZone variant="inline" />
            <SyncPanel sync={sync} theme={editorTheme} />
          </>
        }
        onConnectCanvas={canvasConnect.open}
      />
      <GlobalPdfDropOverlay mode="library" />
      {canvasConnect.dialog}
    </>
  );
}
```

That is the whole integration. `useSync` schedules its own passes (see §5); nothing else has to call it.

### 3a. Putting it in Settings instead (optional, your file)

`SettingsScreen` has no slot for an extra section, so this needs a change in `goodnotes/settings/SettingsScreen.tsx`, which you own. Add `"account"` to `SETTINGS_SECTIONS` and a label for it:

```tsx
export const SETTINGS_SECTIONS = [
  "account",            // <- new, first
  "input",
  …
] as const;

const SECTION_LABELS: Record<SettingsSectionId, string> = {
  account: "Account & sync",
  …
};
```

…then render the section's body wherever the other sections render theirs, passing the `sync` object down through `SettingsScreenProps`:

```tsx
<section id="account" aria-labelledby="gn-set-account">
  <h3 id="gn-set-account">Account &amp; sync</h3>
  <SyncPanel sync={sync} theme={theme} headingId="gn-set-account" />
</section>
```

`SyncPanel` renders no modal, traps no focus and owns no layout; it is a plain block that inherits the surrounding width.

---

## 4. Public API

From `./goodnotes/sync`:

| Export | What it is |
| --- | --- |
| `useSync(options)` | the hook. `{ activeDocId?, backend?, autoSync? }` → `{ status, syncNow, signIn, signUp, signOut, dismissConflicts, authError, clearAuthError, busy }` |
| `SyncPanel` | `{ sync, theme?, showWhenUnconfigured?, headingId? }`. Renders `null` when unconfigured. |
| `isSyncConfigured()` / `getConfigProblem()` | env-var state, without React |
| `getCurrentUser()`, `subscribeAuth()`, `signIn/signUp/signOut`, `sendPasswordReset()` | framework-free auth |
| `syncAll(options)` / `countPending()` | run a pass, or count unsynced notebooks, directly |
| `createSupabaseBackend(client, userId)`, `getClient()` | the plumbing, for a host that wants its own schedule |
| `getDeviceLabel()` / `setDeviceLabel(label)` | the name used in conflict-copy titles ("iPad") |
| `clearStates()` | forget this device's sync watermarks |
| `CONFLICT_TAG` | `"conflict"` — the tag put on every conflict copy, so the shelf can filter them |

`status` (`SyncStatus`) is: `configured`, `phase` (`disabled | signed-out | idle | syncing | offline | error`), `email`, `userId`, `lastSyncedAt`, `pending` (notebooks with unsent changes), `deferred` (doc ids held back because they are open), `conflicts`, `error`. It never contains a token.

---

## 5. When a pass runs

- on sign-in and whenever the session changes;
- 4 s after the library changes (the library's own save is debounced at 750 ms, so this sits behind it);
- every 60 s while the tab is visible — this is how another device's work arrives;
- when the tab becomes visible, and when the browser comes back online.

Passes never overlap. There is **no realtime subscription**: changes from another device show up within about a minute, not instantly. Supabase Realtime would close that gap and is a clean follow-up; it was left out because it could not be tested here against a real project.

---

## 6. The document that is open is never overwritten

The editor holds the scene in memory and autosaves it. If a pass wrote a newer remote version into IndexedDB underneath it, the editor's next autosave would simply overwrite it again — and the canvas would flicker on the way. So a remote update to `activeDocId` is **deferred**: it appears in `status.deferred`, the panel says "a newer version is waiting, close it to load", and the next pass after the user navigates away applies it.

This is why passing `activeDocId` matters. Omit it and an open notebook can be overwritten mid-sentence.

---

## 7. Conflicts — what the app actually does

**Tell the user this:** _"If you edit the same notebook on two devices without syncing in between, nothing is thrown away and nothing is merged. The device that notices keeps your version exactly as it is and saves the other device's version next to it, called 'Lecture 4 (conflict from iPad)' and tagged `conflict`. Both end up on both devices and you decide what to keep."_

How it works. Every row carries a `version` integer, and every push is an UPDATE guarded by `where version = <the version this device last agreed with>`. Two devices pushing from the same base cannot both win: Postgres matches exactly one of them and the loser's update touches zero rows. Each device also remembers the content hash it held at that version, so it can tell "I changed" from "the server changed":

| local changed | server moved | result   |
| ------------- | ------------ | -------- |
| no            | no           | nothing  |
| yes           | no           | push     |
| no            | yes          | pull     |
| yes           | yes          | **fork** |

A fork leaves the local document alone, writes the server's version into a new local notebook, pushes both, and reports a `ConflictRecord`.

**This is not a CRDT and the module never claims to be.** Two people drawing on one page at the same moment get two notebooks, not interleaved strokes. For a personal note-taking app, where the conflict window is "I forgot to close the iPad", a duplicate is annoying and a silently deleted lecture is not.

Related rules, all in `engine.ts`:

- **A delete loses to an edit.** If a notebook is deleted here but another device edited it afterwards, the edit is restored rather than the delete propagated — a deletion is cheap to repeat, an afternoon of notes is not.
- **Deleted elsewhere but edited here?** The notebook is resurrected with the local work intact.
- **If the local library is empty but this device has synced before**, the pass refuses to push tombstones and pulls everything back instead. That is the Safari-eviction case: without the catch, one storage wipe would become permanent, cross-device loss.
- **Signing in as a different account wipes this device's watermarks**, so one student's notebooks can never be pushed into another's account.

---

## 8. Making it live — Supabase dashboard, step by step

1. **Create the project.** supabase.com → New project. Pick a region near the users. Note the database password somewhere safe; you will not need it for this app.
2. **Run the schema.** SQL Editor → New query → paste the whole of `supabase/schema.sql` → Run. It is idempotent, so re-running it after a change is safe. It creates the `documents` table, the `scenes` and `files` buckets, the RLS policies and the `updated_at` trigger.
3. **Check the buckets are private.** Storage → `scenes` and `files` → both must show _Private_. The schema creates them private; if they already existed as public, fix that here.
4. **Copy the keys.** Project Settings → API → copy **Project URL** and the **anon / publishable** key into the two env vars in §2. Do not copy the `service_role` key. It belongs in no file in this repo.
5. **Decide about email confirmation.** Authentication → Providers → Email. With "Confirm email" on (the default), a new account must click a link before it can sign in; the panel says so after sign-up. For a small class deployment, Supabase's built-in mailer is rate-limited to a few messages an hour — add an SMTP provider under Authentication → Emails before real users arrive, or turn confirmation off and accept unverified addresses.
6. **Allow the site.** Authentication → URL Configuration → add the Vercel production domain (and preview domains if you use them) to _Redirect URLs_. Password sign-in does not redirect, but password reset does.
7. **Vercel.** Project Settings → Environment Variables → add both `VITE_` variables to Production (and Preview), then redeploy. Vite inlines them at build time, so an existing deployment will not pick them up without a rebuild.
8. **Verify the isolation yourself.** Create two accounts, then run the commented `do $$ … $$` block at the bottom of `supabase/schema.sql`. It impersonates each user the way PostgREST does and raises an exception if either can read or write the other's row. A green run is a real result; assuming the policies work is not.

### Rolling a key

If the anon key is ever rotated (Project Settings → API → rotate), update the env var and redeploy. Nothing else stores it.

---

## 9. What is deliberately not here

- **No realtime.** 60 s polling; see §5.
- **No sharing between users.** Every policy is `auth.uid() = user_id`. Sharing a notebook means a second table and a second policy, and should not be bolted on by loosening the existing one.
- **No scene-level merge.** See §7.
- **No quota handling.** Supabase's free tier gives 1 GB of storage; a student with 50 scanned PDFs will pass that. The module reports the upload error but does not prune or warn in advance.
- **No `appState` in the dirty check.** Panning and zooming do not count as edits (otherwise scrolling on one device would fight the other for versions), but a pull _does_ restore the other device's scroll position and zoom along with the scene.
