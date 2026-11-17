/**
 * Polls the Heroku bridge for sync jobs and fulfills them with the open
 * Canvas tab's logged-in session.
 */

import {
  canvasApiInTab,
  fetchFileBase64InTab,
  findCanvasTab,
} from "./canvasFetch.js";

const ALARM = "canvas-bridge-poll";
const MAX_INLINE_PDF = 4 * 1024 * 1024; // 4 MB per file
const MAX_INLINE_FILES = 8;

const defaultBridgeUrl = () =>
  "https://chess-tournament-director-6ce5e76147d7.herokuapp.com/api/canvas-bridge";

const loadState = async () => {
  const data = await chrome.storage.local.get([
    "bridgeUrl",
    "roomId",
    "agentSecret",
    "pairCode",
    "canvasHost",
    "lastError",
    "lastStatus",
  ]);
  return {
    bridgeUrl: (data.bridgeUrl || defaultBridgeUrl()).replace(/\/$/, ""),
    roomId: data.roomId || null,
    agentSecret: data.agentSecret || null,
    pairCode: data.pairCode || null,
    canvasHost: data.canvasHost || null,
    lastError: data.lastError || null,
    lastStatus: data.lastStatus || "idle",
  };
};

const saveState = (patch) => chrome.storage.local.set(patch);

const agentHeaders = (secret) => ({
  "Content-Type": "application/json",
  "X-Agent-Secret": secret,
});

const setBadge = async (text, color = "#268029") => {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
};

export const ensureRoom = async () => {
  const state = await loadState();
  if (state.roomId && state.agentSecret && state.pairCode) {
    return state;
  }
  const res = await fetch(`${state.bridgeUrl}/v1/rooms`, { method: "POST" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Bridge create room failed (${res.status}): ${body}`);
  }
  const created = await res.json();
  await saveState({
    roomId: created.roomId,
    agentSecret: created.agentSecret,
    pairCode: created.pairCode,
    lastError: null,
    lastStatus: "paired",
  });
  await setBadge(created.pairCode.slice(0, 3), "#6965db");
  return loadState();
};

const mapAssignment = (a) => ({
  id: String(a.id),
  name: a.name || `Assignment ${a.id}`,
  dueAt: a.due_at ?? null,
  htmlUrl: a.html_url,
  pointsPossible: a.points_possible ?? null,
});

const mapFile = (f) => ({
  id: String(f.id),
  displayName: f.display_name || f.filename || `file-${f.id}`,
  contentType: f["content-type"] || f.content_type,
  size: f.size,
  updatedAt: f.updated_at,
  downloadUrl: f.url,
});

const buildCoursesPayload = async (tabId, host) => {
  const courses = await canvasApiInTab(tabId, "courses", {
    enrollment_state: "active",
    include: "term",
    per_page: 100,
  });
  const list = Array.isArray(courses) ? courses : [];
  return {
    kind: "courses",
    host,
    courses: list.map((c) => ({
      id: String(c.id),
      name: c.name || `Course ${c.id}`,
      courseCode: c.course_code,
      term: c.term?.name,
    })),
    syncedAt: Date.now(),
  };
};

const buildCoursePayload = async (tabId, host, courseId) => {
  const [course, assignments, files] = await Promise.all([
    canvasApiInTab(tabId, `courses/${courseId}`, {}),
    canvasApiInTab(tabId, `courses/${courseId}/assignments`, {
      order_by: "due_at",
      per_page: 100,
    }),
    canvasApiInTab(tabId, `courses/${courseId}/files`, {
      sort: "updated_at",
      per_page: 100,
    }),
  ]);

  const mappedFiles = (Array.isArray(files) ? files : []).map(mapFile);
  const pdfs = mappedFiles.filter(
    (f) =>
      (f.contentType || "").includes("pdf") ||
      /\.pdf$/i.test(f.displayName || ""),
  );

  let inlined = 0;
  for (const file of pdfs) {
    if (inlined >= MAX_INLINE_FILES) {
      break;
    }
    if (!file.downloadUrl) {
      continue;
    }
    try {
      const got = await fetchFileBase64InTab(
        tabId,
        file.downloadUrl,
        MAX_INLINE_PDF,
      );
      if (got && !got.skipped && got.dataBase64) {
        file.dataBase64 = got.dataBase64;
        if (got.contentType) {
          file.contentType = got.contentType;
        }
        inlined += 1;
      }
    } catch {
      // leave metadata only
    }
  }

  return {
    kind: "course",
    courseId: String(courseId),
    courseName: course?.name || `Course ${courseId}`,
    courseCode: course?.course_code,
    host,
    assignments: (Array.isArray(assignments) ? assignments : []).map(
      mapAssignment,
    ),
    files: mappedFiles,
    syncedAt: Date.now(),
  };
};

const fulfillJob = async (state, job) => {
  const canvas = await findCanvasTab();
  if (!canvas) {
    throw new Error(
      "Open Canvas in a Chrome tab and stay logged in, then try again.",
    );
  }
  await saveState({ canvasHost: canvas.host });

  await fetch(
    `${state.bridgeUrl}/v1/rooms/${state.roomId}/jobs/${job.id}/running`,
    { method: "POST", headers: agentHeaders(state.agentSecret) },
  );

  const payload = job.courseId
    ? await buildCoursePayload(canvas.tabId, canvas.host, job.courseId)
    : await buildCoursesPayload(canvas.tabId, canvas.host);

  const res = await fetch(
    `${state.bridgeUrl}/v1/rooms/${state.roomId}/jobs/${job.id}/complete`,
    {
      method: "POST",
      headers: agentHeaders(state.agentSecret),
      body: JSON.stringify({ payload }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
};

const failJob = async (state, jobId, error) => {
  try {
    await fetch(
      `${state.bridgeUrl}/v1/rooms/${state.roomId}/jobs/${jobId}/fail`,
      {
        method: "POST",
        headers: agentHeaders(state.agentSecret),
        body: JSON.stringify({ error: String(error) }),
      },
    );
  } catch {
    // ignore
  }
};

const pollOnce = async () => {
  let state = await loadState();
  if (!state.roomId || !state.agentSecret) {
    return;
  }

  const canvas = await findCanvasTab();
  const host = canvas?.host || state.canvasHost || undefined;

  let res;
  try {
    res = await fetch(
      `${state.bridgeUrl}/v1/rooms/${state.roomId}/agent/ping`,
      {
        method: "POST",
        headers: agentHeaders(state.agentSecret),
        body: JSON.stringify({ canvasHost: host }),
      },
    );
  } catch (err) {
    await saveState({
      lastError: `Bridge unreachable: ${err?.message || err}`,
      lastStatus: "offline",
    });
    await setBadge("!", "#b00020");
    return;
  }

  if (res.status === 401 || res.status === 404) {
    // room expired — recreate
    await saveState({
      roomId: null,
      agentSecret: null,
      pairCode: null,
    });
    try {
      state = await ensureRoom();
    } catch (err) {
      await saveState({ lastError: String(err?.message || err) });
    }
    return;
  }

  if (!res.ok) {
    await saveState({
      lastError: `Ping failed (${res.status})`,
      lastStatus: "error",
    });
    return;
  }

  const body = await res.json();
  const waiting = body.waiting || [];
  await saveState({
    lastError: null,
    lastStatus: canvas ? "online" : "no-canvas-tab",
    canvasHost: host || null,
  });
  await setBadge(
    state.pairCode ? state.pairCode.slice(0, 3) : "on",
    canvas ? "#268029" : "#c99a2e",
  );

  for (const job of waiting) {
    try {
      await fulfillJob(state, job);
      await saveState({ lastStatus: "synced", lastError: null });
    } catch (err) {
      const message = String(err?.message || err);
      await failJob(state, job.id, message);
      await saveState({ lastError: message, lastStatus: "job-error" });
    }
  }
};

const startPolling = () => {
  // Chrome clamps alarm periods to ≥1 minute in many builds; keep a short
  // interval while the service worker is awake, plus an alarm backup.
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  if (!(/** @type {any} */ (globalThis).__canvasBridgeInterval)) {
    /** @type {any} */ (globalThis).__canvasBridgeInterval = setInterval(() => {
      void pollOnce();
    }, 3000);
  }
};

chrome.runtime.onInstalled.addListener(startPolling);
chrome.runtime.onStartup.addListener(startPolling);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) {
    void pollOnce();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "ENSURE_ROOM") {
      if (message.bridgeUrl) {
        await saveState({ bridgeUrl: String(message.bridgeUrl).replace(/\/$/, "") });
      }
      const state = await ensureRoom();
      await pollOnce();
      return state;
    }
    if (message?.type === "GET_STATE") {
      return loadState();
    }
    if (message?.type === "SET_BRIDGE_URL") {
      await saveState({
        bridgeUrl: String(message.bridgeUrl || "").replace(/\/$/, ""),
        roomId: null,
        agentSecret: null,
        pairCode: null,
      });
      const state = await ensureRoom();
      return state;
    }
    if (message?.type === "POLL_NOW") {
      await pollOnce();
      return loadState();
    }
    if (message?.type === "RESET_ROOM") {
      await saveState({
        roomId: null,
        agentSecret: null,
        pairCode: null,
      });
      return ensureRoom();
    }
    return { error: "unknown message" };
  })()
    .then(sendResponse)
    .catch((err) => sendResponse({ error: String(err?.message || err) }));
  return true;
});

// kick off
void (async () => {
  try {
    await ensureRoom();
    await pollOnce();
  } catch (err) {
    await saveState({ lastError: String(err?.message || err) });
  }
})();
