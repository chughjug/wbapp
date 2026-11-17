/**
 * Polls the Heroku bridge for sync jobs and fulfills them with the open
 * Canvas tab's logged-in session.
 */

import {
  canvasApiInTab,
  canvasApiInTabSoft,
  fetchFileBase64InTab,
  findCanvasTab,
} from "./canvasFetch.js";

const ALARM = "canvas-bridge-poll";
/** Per-file / per-chunk caps so the Heroku relay (20–25mb) accepts uploads. */
const MAX_INLINE_FILE = 8 * 1024 * 1024; // 8 MB per file
const MAX_CHUNK_FILES = 6;
const MAX_PAYLOAD_CHARS = 10 * 1024 * 1024;

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

const courseLabel = (c) => {
  const name = (c?.name || "").trim();
  const code = (c?.course_code || "").trim();
  if (name) {
    return name;
  }
  if (code) {
    return code;
  }
  return `Course ${c?.id}`;
};

/** Canvas only allows one enrollment_state per request — merge all. */
const fetchAllCourses = async (tabId) => {
  const states = ["active", "completed", "invited_or_pending"];
  const byId = new Map();
  for (const enrollment_state of states) {
    const page = await canvasApiInTabSoft(tabId, "courses", {
      enrollment_state,
      include: ["term"],
      per_page: 100,
    });
    if (!Array.isArray(page)) {
      continue;
    }
    for (const c of page) {
      if (c?.id == null) {
        continue;
      }
      const id = String(c.id);
      // Prefer the richer "active" record if we already saw a stub.
      if (!byId.has(id) || enrollment_state === "active") {
        byId.set(id, c);
      }
    }
  }

  // Fallback: unfiltered list (some schools reject enrollment_state).
  if (byId.size === 0) {
    const page = await canvasApiInTabSoft(tabId, "courses", {
      include: ["term"],
      per_page: 100,
    });
    if (Array.isArray(page)) {
      for (const c of page) {
        if (c?.id != null) {
          byId.set(String(c.id), c);
        }
      }
    }
  }

  return [...byId.values()].sort((a, b) =>
    courseLabel(a).localeCompare(courseLabel(b), undefined, {
      sensitivity: "base",
    }),
  );
};

/** Collect files from course root, folders, and module items. */
const fetchAllCourseFiles = async (tabId, courseId) => {
  const byId = new Map();
  const add = (list) => {
    if (!Array.isArray(list)) {
      return;
    }
    for (const f of list) {
      if (f?.id == null) {
        continue;
      }
      byId.set(String(f.id), f);
    }
  };

  add(
    await canvasApiInTabSoft(tabId, `courses/${courseId}/files`, {
      sort: "updated_at",
      order: "desc",
      per_page: 100,
    }),
  );

  const folders = await canvasApiInTabSoft(tabId, `courses/${courseId}/folders`, {
    per_page: 100,
  });
  if (Array.isArray(folders)) {
    // Cap folder walks so a huge course still finishes.
    for (const folder of folders.slice(0, 80)) {
      if (folder?.id == null) {
        continue;
      }
      add(
        await canvasApiInTabSoft(tabId, `folders/${folder.id}/files`, {
          per_page: 100,
        }),
      );
    }
  }

  const modules = await canvasApiInTabSoft(tabId, `courses/${courseId}/modules`, {
    include: ["items"],
    per_page: 100,
  });
  if (Array.isArray(modules)) {
    const missingIds = [];
    for (const mod of modules) {
      const items = Array.isArray(mod?.items) ? mod.items : [];
      for (const item of items) {
        if (item?.type === "File" && item.content_id != null) {
          const id = String(item.content_id);
          if (!byId.has(id)) {
            missingIds.push(id);
          }
        }
      }
    }
    for (const fileId of missingIds.slice(0, 100)) {
      const file = await canvasApiInTabSoft(tabId, `files/${fileId}`, {});
      if (file && file.id != null) {
        byId.set(String(file.id), file);
      }
    }
  }

  return [...byId.values()];
};

const stripInlineData = (payload) => ({
  ...payload,
  files: (payload.files || []).map(({ dataBase64, ...rest }) => rest),
  pendingFileIds: (payload.files || []).map((f) => f.id),
});

/** Download file bytes into mapped file records until the chunk budget fills. */
const inlineFileBytes = async (tabId, mappedFiles) => {
  const ordered = [...mappedFiles].sort(
    (a, b) => (a.size || 0) - (b.size || 0),
  );
  let inlined = 0;
  let approxChars = 0;
  for (const file of ordered) {
    if (inlined >= MAX_CHUNK_FILES) {
      break;
    }
    if (!file.downloadUrl || file.dataBase64) {
      continue;
    }
    try {
      const got = await fetchFileBase64InTab(
        tabId,
        file.downloadUrl,
        MAX_INLINE_FILE,
      );
      if (got && !got.skipped && got.dataBase64) {
        const next = approxChars + got.dataBase64.length;
        if (next > MAX_PAYLOAD_CHARS) {
          break;
        }
        file.dataBase64 = got.dataBase64;
        if (got.contentType) {
          file.contentType = got.contentType;
        }
        approxChars = next;
        inlined += 1;
      } else if (got?.skipped) {
        file.skippedTooLarge = true;
        file.size = got.size || file.size;
      }
    } catch {
      // leave metadata only — iPad can retry later
    }
  }
};

const buildCoursesPayload = async (tabId, host) => {
  const list = await fetchAllCourses(tabId);
  return {
    kind: "courses",
    host,
    courses: list.map((c) => ({
      id: String(c.id),
      name: courseLabel(c),
      courseCode: c.course_code || undefined,
      term: c.term?.name,
    })),
    syncedAt: Date.now(),
  };
};

/**
 * Full course catalog (assignments + every file's metadata). Bytes come in
 * follow-up fileIds chunk jobs so nothing is dropped for size.
 */
const buildCoursePayload = async (tabId, host, courseId) => {
  const [course, assignments, rawFiles] = await Promise.all([
    canvasApiInTabSoft(tabId, `courses/${courseId}`, {}),
    canvasApiInTabSoft(tabId, `courses/${courseId}/assignments`, {
      order_by: "due_at",
      per_page: 100,
    }),
    fetchAllCourseFiles(tabId, courseId),
  ]);

  const mappedFiles = rawFiles.map(mapFile);
  const pendingFileIds = mappedFiles
    .filter((f) => f.downloadUrl)
    .map((f) => f.id);

  return {
    kind: "course",
    courseId: String(courseId),
    courseName: courseLabel(course || { id: courseId }),
    courseCode: course?.course_code || undefined,
    host,
    assignments: (Array.isArray(assignments) ? assignments : []).map(
      mapAssignment,
    ),
    files: mappedFiles,
    pendingFileIds,
    syncedAt: Date.now(),
  };
};

/** Chunk job: download specific file ids and return their bytes. */
const buildFilesChunkPayload = async (tabId, host, courseId, fileIds) => {
  const course = courseId
    ? await canvasApiInTabSoft(tabId, `courses/${courseId}`, {})
    : null;
  const mapped = [];
  for (const fileId of fileIds) {
    const raw = await canvasApiInTabSoft(tabId, `files/${fileId}`, {});
    if (raw && raw.id != null) {
      mapped.push(mapFile(raw));
    }
  }
  await inlineFileBytes(tabId, mapped);
  return {
    kind: "files",
    courseId: courseId ? String(courseId) : undefined,
    courseName: course ? courseLabel(course) : undefined,
    courseCode: course?.course_code || undefined,
    host,
    files: mapped,
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

  let payload;
  if (Array.isArray(job.fileIds) && job.fileIds.length > 0) {
    if (!job.courseId) {
      throw new Error("File chunk job is missing courseId.");
    }
    payload = await buildFilesChunkPayload(
      canvas.tabId,
      canvas.host,
      job.courseId,
      job.fileIds,
    );
  } else if (job.courseId) {
    payload = await buildCoursePayload(canvas.tabId, canvas.host, job.courseId);
  } else {
    payload = await buildCoursesPayload(canvas.tabId, canvas.host);
  }

  const upload = async (body) =>
    fetch(
      `${state.bridgeUrl}/v1/rooms/${state.roomId}/jobs/${job.id}/complete`,
      {
        method: "POST",
        headers: agentHeaders(state.agentSecret),
        body: JSON.stringify({ payload: body }),
      },
    );

  let res = await upload(payload);
  // If the relay rejects a huge body, retry with metadata only so the iPad
  // still gets the full course/file list.
  if (!res.ok && payload.files?.some((f) => f.dataBase64)) {
    payload = stripInlineData(payload);
    res = await upload(payload);
  }
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
