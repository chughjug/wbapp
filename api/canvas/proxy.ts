/**
 * Read-only relay to a Canvas LMS instance.
 *
 * Canvas sends no CORS headers and Instructure-hosted instances cannot be
 * configured to, so a browser cannot call the Canvas API directly. This
 * function is the relay: the client sends the instance host and the user's
 * access token as headers, and this forwards the request server-side.
 *
 * SECURITY. This endpoint takes a destination host AND a bearer credential
 * from the caller, which is the classic shape of an open proxy that can be
 * abused to exfiltrate that credential to an attacker's server, or to reach
 * machines inside the hosting network (SSRF). The guards below are the whole
 * point of the file, so do not relax them casually:
 *
 *   - GET only. Nothing here should ever write to a student's LMS.
 *   - https only, default port only.
 *   - The host must look like a real Canvas instance and must not be
 *     localhost, an IP literal, or an internal/".local" name.
 *   - Only an allowlist of Canvas API paths is forwarded.
 *   - The token is read from a header, never logged, and never echoed back.
 */

export const config = { runtime: "nodejs" };

/** Canvas API paths this relay is willing to forward. Read-only. */
const ALLOWED_PATHS: RegExp[] = [
  /^courses\/?$/,
  /^courses\/\d+\/?$/,
  /^courses\/\d+\/assignments\/?$/,
  /^courses\/\d+\/assignments\/\d+\/?$/,
  /^courses\/\d+\/files\/?$/,
  /^courses\/\d+\/folders\/?$/,
  /^folders\/\d+\/files\/?$/,
  /^files\/\d+\/?$/,
  /^users\/self\/?$/,
  /^users\/self\/favorites\/courses\/?$/,
  /^users\/self\/todo\/?$/,
  /^users\/self\/upcoming_events\/?$/,
  /^planner\/items\/?$/,
];

const PRIVATE_HOST = new RegExp(
  [
    "^localhost$",
    "^127\\.",
    "^0\\.",
    "^10\\.",
    "^192\\.168\\.",
    "^172\\.(1[6-9]|2\\d|3[01])\\.",
    "^169\\.254\\.", // link-local, incl. cloud metadata
    "\\.local$",
    "\\.internal$",
  ].join("|"),
);

/** An IPv4/IPv6 literal is never a legitimate Canvas instance here. */
const IP_LITERAL = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i;

const isAllowedHost = (host: string): boolean => {
  if (!host || host.length > 253) {
    return false;
  }
  if (IP_LITERAL.test(host) || PRIVATE_HOST.test(host)) {
    return false;
  }
  // a dotted hostname, nothing exotic
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host);
};

const isAllowedPath = (path: string): boolean =>
  ALLOWED_PATHS.some((re) => re.test(path));

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "This relay is read-only." });
    return;
  }

  const host = String(req.headers["x-canvas-host"] ?? "").trim().toLowerCase();
  const token = String(req.headers["x-canvas-token"] ?? "").trim();
  const path = String(req.query?.path ?? "").replace(/^\/+/, "");
  const search = String(req.query?.query ?? "");

  if (!host || !token || !path) {
    res
      .status(400)
      .json({ error: "Missing Canvas host, token, or path." });
    return;
  }
  if (!isAllowedHost(host)) {
    res.status(400).json({ error: "That does not look like a Canvas host." });
    return;
  }
  if (!isAllowedPath(path)) {
    // naming the path is safe; it contains no credential
    res.status(403).json({ error: `This relay does not forward "${path}".` });
    return;
  }

  const url = `https://${host}/api/v1/${path}${search ? `?${search}` : ""}`;

  try {
    const upstream = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json+canvas-string-ids, application/json",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });

    // Canvas paginates with Link headers; pass it through so the client can
    // follow pages without us having to understand every endpoint.
    const link = upstream.headers.get("link");
    if (link) {
      res.setHeader("x-canvas-link", link);
    }
    res.setHeader("cache-control", "no-store");
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader(
      "content-type",
      upstream.headers.get("content-type") ?? "application/json",
    );
    res.send(body);
  } catch (error) {
    // deliberately vague: never surface anything that could include the token
    const timedOut =
      error instanceof Error && /timeout|abort/i.test(error.message);
    res
      .status(timedOut ? 504 : 502)
      .json({ error: timedOut ? "Canvas timed out." : "Could not reach Canvas." });
  }
}
