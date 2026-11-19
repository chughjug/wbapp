# Accounts and cross-device sync — where this stands, and what is left

A design note, not a spec. It describes what the app does today, what is
missing for LaTeX documents and exported PDFs, and the account-creation
path I would recommend — with the trade-offs stated rather than buried.

---

## 1. What already works

`goodnotes/sync` is built and wired. With no Supabase environment
variables set it is completely inert, which is the default: the app runs
local-only and nothing on screen refers to a feature the user does not
have.

**Already in place**

- Email + password sign-up and sign-in (`auth.ts`).
- A `documents` table in Postgres holding metadata only — title, course,
  due date, tags, page count, timestamps — so the shelf can sort and
  filter without downloading scenes.
- Two Storage buckets: `scenes/<uid>/<docId>/scene.json` and
  `files/<uid>/<fileId>.json`.
- Row Level Security on both the table and the buckets, keyed to
  `auth.uid()`. RLS is the only thing separating users, so the schema
  locks it at the database rather than trusting the client.
- `config.ts` refuses to start if something shaped like a `service_role`
  key is pasted into the anon slot.
- Conflict handling that never merges and never discards: if two devices
  edit from the same version, the one that notices keeps its own copy and
  saves the other alongside it as "Lecture 4 (conflict from iPad)".
- Content-addressed files, so adding one stroke to a notebook containing
  a 20 MB imported PDF is a ~40 KB upload, not a 20 MB one.

**LaTeX documents sync too, as of this change.** A `.tex` source is
mirrored into the document's scene (`appState.goodnotesLatex`), which
means it rides the existing engine, gets snapshots in Earlier versions,
and travels in a backup — with no change to the sync engine itself. A
document arriving on a second device is recognised as LaTeX from the
scene and adopted into that device's local store on first open.

---

## 2. What is missing

### 2.1 Exported PDFs are not stored anywhere

Export writes a file to the device and forgets it. Nothing uploads it,
so "the PDF I submitted on Tuesday" exists only wherever the download
went. Two options:

| | Store the PDF | Re-export on demand |
| --- | --- | --- |
| Cost | A bucket, and real bytes per export | Nothing |
| Fidelity | Exactly what was submitted | Whatever the document says *now* |
| Offline | Needs the file cached | Works, the document is local |

**Recommendation: store it, but only when the user asks.** A "Keep a
copy" checkbox on export, writing to a third bucket
`exports/<uid>/<docId>/<timestamp>.pdf`. The value is specifically that
it is frozen — a student arguing about what they submitted needs the
artefact, not a regeneration. Making it automatic would quietly upload a
few megabytes every time someone hits Export.

### 2.2 Email + password is the wrong default for this audience

The method is built, but it is the one students abandon. It needs a
password they will forget, and Supabase's built-in mailer is explicitly
not for production (a handful of messages an hour), so it needs an SMTP
provider configured before it works at all.

### 2.3 Safari's seven-day cap is a deadline, not a risk

Safari evicts script-writable storage after seven days of no interaction
for sites that are not on the Home Screen. For a local-only notes app
that is not a caveat; it is data loss on a timer. This is the strongest
argument for accounts existing at all, and it should be the one the app
makes.

---

## 3. The account path I would build

### Step 1 — stay anonymous by default

No account, no prompt, nothing. The app already works this way and
should keep doing so. A student should be able to take a full term of
notes without ever seeing a sign-up form.

### Step 2 — ask once, where the loss is real

One line in Settings and one in the Browse drawer, stating the actual
reason rather than "Sign up to sync!":

> These notebooks live only in this browser. Safari deletes site data
> after seven days of not opening the app. Add an email and they will be
> on your other devices too — and still here next term.

Dismissible, and it stays dismissed.

### Step 3 — make the sign-up a magic link, not a password

Supabase supports one-time email links out of the box. For this audience
that is the right default:

- Nothing to remember and nothing to leak.
- No password-reset flow to build, support, or get wrong.
- It proves the address, which matters later for the Canvas pairing.

Keep password sign-in as the second option for people who want it; the
code is already written.

**This requires an SMTP provider** (Resend, Postmark, SES — any of them).
That is the one piece of real infrastructure this path needs and it
should be decided before building the UI around it.

### Step 4 — adopt the local library into the new account

The moment that decides whether anyone keeps the account. On first
sign-in, every local document is uploaded and claimed by the new
`user_id`. The rules that make it safe:

1. **Never destructive.** Nothing local is deleted, before or after.
2. **Idempotent.** Signing in on a device that has already adopted does
   nothing; documents carry stable ids.
3. **Visible.** A progress line — "12 of 40 notebooks" — and a result
   that names what failed, if anything.
4. **Resumable.** Interrupted halfway, signing in again finishes the
   rest.

If the same account signs in on a second device with its own local
documents, both sets merge by id; genuinely different documents with the
same id go through the existing conflict path.

### Step 5 — sign out protects the device, not the data

"Sign out" should say what it does: stop syncing, and ask whether to
keep local copies on this device. A shared library computer wants them
gone; a personal laptop does not. Defaulting either way silently is
wrong.

---

## 4. What to build, in order

1. **Magic-link sign-in** alongside the existing password path, plus the
   SMTP provider. — *small, blocked on choosing a provider*
2. **Adoption on first sign-in**, with the four rules above. — *the
   largest piece, and the one that decides retention*
3. **The honest prompt** in Settings and Browse. — *small*
4. **"Keep a copy" on export**, with an `exports` bucket and the same
   RLS. — *small, needs a storage-cost decision*
5. **Sign-out with the local-copies choice.** — *small*

## 5. Things deliberately not proposed

- **OAuth (Google / Apple).** Needs a provider app, review for Apple, and
  a privacy policy. Worth doing eventually; not worth blocking accounts
  on.
- **Real-time collaborative editing.** The CRDT groundwork exists, but
  "my notes are on both devices" and "two people edit one page at once"
  are different products. The second one needs presence, permissions and
  invitations.
- **Server-side LaTeX compilation.** See `goodnotes/latex/engine.ts`: it
  would mean running a build farm, and it breaks the offline-first
  property that makes the rest of this app work.

## 6. The security line that does not move

The app uses the Supabase **project URL and anon key** only. Both are
public by design. The **`service_role` key must never** be given to the
app, put in a `VITE_` variable, or committed — it bypasses RLS entirely,
and RLS is the only thing separating one student's notes from another's.
`config.ts` already refuses to start if it looks like one has been
pasted into the anon slot; that check should stay.
