/**
 * Vite env vars this module reads.
 *
 * `excalidraw-app/vite-env.d.ts` declares `ImportMetaEnv` as a global
 * interface and is owned by the host, so this file *merges* into it rather
 * than editing it. Both keys are optional: with neither set the module is
 * inert (see `config.ts`).
 *
 * Both values are public by design — the anon key is a JWT that only ever
 * acts through Row Level Security. The `service_role` key must never appear
 * in a `VITE_`-prefixed variable, because every `VITE_` variable is inlined
 * into the client bundle.
 */

interface ImportMetaEnv {
  /** e.g. `https://abcdefghijklm.supabase.co` */
  readonly VITE_SUPABASE_URL?: string;
  /** The project's **anon** (publishable) key. Never the service role key. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
