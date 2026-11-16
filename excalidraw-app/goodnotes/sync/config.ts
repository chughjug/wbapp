/**
 * Is sync configured at all, and with what.
 *
 * Everything in this module funnels through {@link getSyncConfig}. When it
 * returns `null` the module is *inert*: no network, no client construction,
 * no `@supabase/supabase-js` chunk fetched, no console output. That is the
 * default state of a developer checkout and of any deployment that has not
 * set the two env vars, and the app must behave exactly as it did before
 * this module existed.
 */

/** Resolved, validated Supabase connection details. */
export interface SyncConfig {
  url: string;
  anonKey: string;
}

/**
 * A `service_role` key would be a catastrophic thing to ship in a client
 * bundle: it bypasses Row Level Security entirely. Supabase keys are JWTs
 * whose payload carries `"role":"service_role"`, so a cheap substring check
 * on the base64 payload catches a paste-the-wrong-key mistake at startup.
 */
const looksLikeServiceRoleKey = (key: string): boolean => {
  const payload = key.split(".")[1];
  if (!payload) {
    return false;
  }
  try {
    return atob(payload.replace(/-/g, "+").replace(/_/g, "/")).includes(
      "service_role",
    );
  } catch {
    return false;
  }
};

let cached: SyncConfig | null | undefined;

const read = (name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY"): string => {
  // `import.meta.env` is statically replaced by Vite; the guard is for the
  // test/node environments where it is absent.
  const env = typeof import.meta === "undefined" ? undefined : import.meta.env;
  const value = env?.[name];
  return typeof value === "string" ? value.trim() : "";
};

/**
 * The connection details, or `null` when sync is switched off.
 *
 * Never throws. A misconfiguration (half-set vars, an http URL, a pasted
 * service-role key) is reported through {@link getConfigProblem} and treated
 * as "switched off", because a broken sync must not break the editor.
 */
export const getSyncConfig = (): SyncConfig | null => {
  if (cached !== undefined) {
    return cached;
  }
  cached = resolve();
  return cached;
};

let problem: string | null = null;

const resolve = (): SyncConfig | null => {
  const url = read("VITE_SUPABASE_URL");
  const anonKey = read("VITE_SUPABASE_ANON_KEY");

  if (!url && !anonKey) {
    problem = null; // the ordinary, silent, unconfigured case
    return null;
  }
  if (!url || !anonKey) {
    problem =
      "Sync is half-configured: set both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.";
    return null;
  }
  if (!/^https:\/\/[^\s/]+/.test(url)) {
    problem = "VITE_SUPABASE_URL must be an https:// project URL.";
    return null;
  }
  if (looksLikeServiceRoleKey(anonKey)) {
    // Deliberately refuses to run rather than quietly shipping it.
    problem =
      "VITE_SUPABASE_ANON_KEY looks like a service_role key. Sync is disabled. " +
      "Replace it with the project's anon/publishable key and rotate the leaked key.";
    return null;
  }
  problem = null;
  return { url: url.replace(/\/+$/, ""), anonKey };
};

/**
 * A human-readable reason sync is off *despite* env vars being present, or
 * `null`. The plain unconfigured case is not a problem and returns `null`.
 */
export const getConfigProblem = (): string | null => {
  getSyncConfig();
  return problem;
};

/** True when both env vars are present and sane. */
export const isSyncConfigured = (): boolean => getSyncConfig() !== null;

/** Test seam: forget the memoised config. */
export const resetSyncConfigCache = (): void => {
  cached = undefined;
  problem = null;
};
