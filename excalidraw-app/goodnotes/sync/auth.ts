/**
 * Sign-in, sign-out, and who is signed in.
 *
 * Email + password, because it is the one Supabase auth method that works
 * on a fresh project with nothing else configured. Magic links need an SMTP
 * provider (the built-in sender is rate-limited to a handful of mails an
 * hour and is explicitly not for production) and OAuth needs a provider app
 * per vendor; both are reasonable follow-ups and neither should block
 * "my notes are on my iPad as well as my laptop".
 *
 * Tokens are held by `supabase-js` in `localStorage` under its own key (see
 * `client.ts`). This module never reads them, never logs them, never puts
 * them in a URL and never hands them to the UI. The only identity that
 * leaves here is an id and an email address the user typed themselves.
 */

import { getClient } from "./client";
import { isSyncConfigured } from "./config";

/** The signed-in user, reduced to what the UI is allowed to see. */
export interface SyncUser {
  id: string;
  email: string | null;
}

export type AuthResult =
  | { ok: true; needsConfirmation?: boolean }
  | { ok: false; message: string };

/**
 * Supabase's auth errors are already user-safe, but they are terse and
 * occasionally alarming. Translate the ones a student will actually hit.
 */
const friendly = (message: string): string => {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login credentials")) {
    return "That email and password don't match an account.";
  }
  if (lower.includes("email not confirmed")) {
    return "Check your inbox and confirm your email address first.";
  }
  if (lower.includes("user already registered")) {
    return "There's already an account with that email — sign in instead.";
  }
  if (lower.includes("password should be")) {
    return "Pick a longer password (at least 6 characters).";
  }
  if (lower.includes("failed to fetch") || lower.includes("network")) {
    return "Can't reach the server. Your notes are saved on this device.";
  }
  return message;
};

/** The current user, or `null` when signed out or unconfigured. */
export const getCurrentUser = async (): Promise<SyncUser | null> => {
  const client = await getClient();
  if (!client) {
    return null;
  }
  try {
    const { data } = await client.auth.getSession();
    const user = data.session?.user;
    return user ? { id: user.id, email: user.email ?? null } : null;
  } catch {
    return null;
  }
};

/**
 * Subscribe to sign-in / sign-out / token-refresh. Returns an unsubscribe
 * function. Fires once with the current value as soon as it is known.
 */
export const subscribeAuth = (
  listener: (user: SyncUser | null) => void,
): (() => void) => {
  let active = true;
  let unsubscribe: (() => void) | null = null;

  if (!isSyncConfigured()) {
    // Inert: report "signed out" once and never touch the network.
    listener(null);
    return () => {
      active = false;
    };
  }

  void (async () => {
    const client = await getClient();
    if (!client || !active) {
      listener(null);
      return;
    }
    listener(await getCurrentUser());
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) {
        return;
      }
      const user = session?.user;
      listener(user ? { id: user.id, email: user.email ?? null } : null);
    });
    unsubscribe = () => data.subscription.unsubscribe();
  })();

  return () => {
    active = false;
    unsubscribe?.();
  };
};

export const signIn = async (
  email: string,
  password: string,
): Promise<AuthResult> => {
  const client = await getClient();
  if (!client) {
    return { ok: false, message: "Sync is not configured for this app." };
  }
  try {
    const { error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return error
      ? { ok: false, message: friendly(error.message) }
      : { ok: true };
  } catch (error: any) {
    return { ok: false, message: friendly(String(error?.message ?? error)) };
  }
};

export const signUp = async (
  email: string,
  password: string,
): Promise<AuthResult> => {
  const client = await getClient();
  if (!client) {
    return { ok: false, message: "Sync is not configured for this app." };
  }
  try {
    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password,
    });
    if (error) {
      return { ok: false, message: friendly(error.message) };
    }
    // With "Confirm email" on (the Supabase default) there is a user but no
    // session until the link is clicked.
    return { ok: true, needsConfirmation: !data.session };
  } catch (error: any) {
    return { ok: false, message: friendly(String(error?.message ?? error)) };
  }
};

export const signOut = async (): Promise<void> => {
  const client = await getClient();
  if (!client) {
    return;
  }
  try {
    await client.auth.signOut();
  } catch {
    // Already gone, or offline. The local session is cleared either way by
    // supabase-js; nothing here depends on the call succeeding.
  }
};

/** Send a password-reset email. Needs email delivery configured. */
export const sendPasswordReset = async (email: string): Promise<AuthResult> => {
  const client = await getClient();
  if (!client) {
    return { ok: false, message: "Sync is not configured for this app." };
  }
  try {
    const { error } = await client.auth.resetPasswordForEmail(email.trim());
    return error
      ? { ok: false, message: friendly(error.message) }
      : { ok: true };
  } catch (error: any) {
    return { ok: false, message: friendly(String(error?.message ?? error)) };
  }
};
