/**
 * The one Supabase client, created lazily.
 *
 * `@supabase/supabase-js` is ~120 kB of JavaScript. It is loaded through a
 * dynamic `import()` so that a deployment with no env vars never fetches the
 * chunk at all: the unconfigured app is byte-for-byte the app that existed
 * before this module, plus a few hundred bytes of guard code.
 *
 * Only the project URL and the anon key are used. Both are public by design
 * — the anon key is a JWT whose only privilege is "act as an anonymous or
 * signed-in user", and Row Level Security is what actually separates users.
 * Nothing in this module reads, accepts or stores a `service_role` key;
 * `config.ts` refuses to start if one is pasted into the anon slot.
 */

import { getSyncConfig } from "./config";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Keeps this app's session out of the way of anything else on the origin,
 * and makes "sign out everywhere on this device" a single key to clear.
 */
export const AUTH_STORAGE_KEY = "goodnotes-sync-auth";

let pending: Promise<SupabaseClient | null> | null = null;

/**
 * The shared client, or `null` when sync is not configured.
 *
 * Never throws: a failure to load the chunk (offline first paint, blocked
 * CDN) resolves to `null` and the app stays local-only.
 */
export const getClient = async (): Promise<SupabaseClient | null> => {
  const config = getSyncConfig();
  if (!config) {
    return null;
  }
  if (!pending) {
    pending = import("@supabase/supabase-js")
      .then(({ createClient }) =>
        createClient(config.url, config.anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            // This app owns its own routing and never wants credentials in a
            // URL; a confirmation link's hash is ignored rather than consumed.
            detectSessionInUrl: false,
            storageKey: AUTH_STORAGE_KEY,
          },
        }),
      )
      .catch(() => null);
  }
  return pending;
};

/** Test seam: drop the memoised client. */
export const resetClient = (): void => {
  pending = null;
};
