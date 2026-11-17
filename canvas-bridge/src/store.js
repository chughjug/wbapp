/**
 * In-memory room/job store.
 *
 * Fine for a single Heroku dyno MVP. For multi-dyno, swap for Redis keyed by
 * the same shapes — the HTTP API stays identical.
 */

const PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL_MS = 1000 * 60 * 60 * 12; // 12h
const JOB_TTL_MS = 1000 * 60 * 30; // 30m
const MAX_PAYLOAD_BYTES = 12 * 1024 * 1024; // 12 MB JSON ceiling

/** @type {Map<string, import("./types.js").Room>} */
const roomsById = new Map();
/** @type {Map<string, string>} */
const roomIdByPairCode = new Map();

const randomId = (bytes = 16) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const randomPairCode = (length = 6) => {
  const buf = crypto.getRandomValues(new Uint8Array(length));
  return [...buf].map((b) => PAIR_ALPHABET[b % PAIR_ALPHABET.length]).join("");
};

const now = () => Date.now();

export const pruneExpired = () => {
  const t = now();
  for (const [id, room] of roomsById) {
    if (t - room.createdAt > ROOM_TTL_MS) {
      roomsById.delete(id);
      roomIdByPairCode.delete(room.pairCode);
      continue;
    }
    for (const [jobId, job] of room.jobs) {
      if (t - job.createdAt > JOB_TTL_MS) {
        room.jobs.delete(jobId);
      }
    }
  }
};

/**
 * Create a room for a laptop agent. Returns secrets the extension must store.
 */
export const createRoom = () => {
  pruneExpired();
  let pairCode = randomPairCode();
  while (roomIdByPairCode.has(pairCode)) {
    pairCode = randomPairCode();
  }
  const room = {
    id: randomId(12),
    pairCode,
    agentSecret: randomId(24),
    canvasHost: undefined,
    createdAt: now(),
    lastAgentSeenAt: now(),
    jobs: new Map(),
  };
  roomsById.set(room.id, room);
  roomIdByPairCode.set(pairCode, room.id);
  return {
    roomId: room.id,
    pairCode: room.pairCode,
    agentSecret: room.agentSecret,
  };
};

export const getRoom = (roomId) => {
  pruneExpired();
  return roomsById.get(roomId) ?? null;
};

export const getRoomByPairCode = (pairCode) => {
  pruneExpired();
  const id = roomIdByPairCode.get(String(pairCode || "").toUpperCase());
  return id ? roomsById.get(id) ?? null : null;
};

export const touchAgent = (room, canvasHost) => {
  room.lastAgentSeenAt = now();
  if (canvasHost) {
    room.canvasHost = String(canvasHost).toLowerCase();
  }
};

export const agentOnline = (room, maxAgeMs = 15_000) =>
  now() - room.lastAgentSeenAt <= maxAgeMs;

export const createJob = (room, { courseId } = {}) => {
  const job = {
    id: randomId(10),
    roomId: room.id,
    status: "waiting",
    courseId: courseId ? String(courseId) : undefined,
    createdAt: now(),
    updatedAt: now(),
  };
  room.jobs.set(job.id, job);
  return job;
};

export const listWaitingJobs = (room) =>
  [...room.jobs.values()].filter((j) => j.status === "waiting");

export const getJob = (room, jobId) => room.jobs.get(jobId) ?? null;

export const markJobRunning = (job) => {
  job.status = "running";
  job.updatedAt = now();
};

export const completeJob = (job, payload) => {
  const json = JSON.stringify(payload);
  if (json.length > MAX_PAYLOAD_BYTES) {
    job.status = "error";
    job.error = `Payload too large (${json.length} bytes). Sync fewer/smaller files.`;
    job.updatedAt = now();
    return job;
  }
  job.status = "ready";
  job.payload = payload;
  job.error = undefined;
  job.updatedAt = now();
  return job;
};

export const failJob = (job, error) => {
  job.status = "error";
  job.error = String(error || "Unknown error");
  job.updatedAt = now();
  return job;
};

export const MAX_PAYLOAD_BYTES_EXPORT = MAX_PAYLOAD_BYTES;
