/**
 * Canvas bridge relay — Heroku-ready Express server.
 *
 * Flow:
 *  1. Laptop Chrome extension POST /v1/rooms → pairCode
 *  2. iPad joins with pairCode via POST /v1/rooms/join
 *  3. iPad POST /v1/rooms/:id/jobs → waiting job
 *  4. Extension polls GET /v1/rooms/:id/jobs/waiting, fetches Canvas in-session,
 *     POST /v1/rooms/:id/jobs/:jobId/complete with course payload
 *  5. iPad GET /v1/rooms/:id/jobs/:jobId until status=ready, then imports
 */

import cors from "cors";
import express from "express";

import {
  agentOnline,
  completeJob,
  createJob,
  createRoom,
  failJob,
  getJob,
  getRoom,
  getRoomByPairCode,
  listWaitingJobs,
  markJobRunning,
  touchAgent,
} from "./store.js";

const app = express();
const PORT = Number(process.env.PORT || 8787);

app.use(cors({ origin: true }));
app.use(express.json({ limit: "25mb" }));

const requireAgent = (req, res, next) => {
  const room = getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found or expired." });
    return;
  }
  const secret = String(req.headers["x-agent-secret"] || "");
  if (!secret || secret !== room.agentSecret) {
    res.status(401).json({ error: "Invalid agent secret." });
    return;
  }
  req.room = room;
  next();
};

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "wbapp-canvas-bridge" });
});

/** Laptop extension: open a pairing room. */
app.post("/v1/rooms", (_req, res) => {
  const room = createRoom();
  res.status(201).json(room);
});

/** iPad: join with the 6-character code shown in the extension popup. */
app.post("/v1/rooms/join", (req, res) => {
  const pairCode = String(req.body?.pairCode || "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
  const room = getRoomByPairCode(pairCode);
  if (!room) {
    res.status(404).json({ error: "No laptop found for that code. Is the extension open?" });
    return;
  }
  res.json({
    roomId: room.id,
    pairCode: room.pairCode,
    agentOnline: agentOnline(room),
    canvasHost: room.canvasHost ?? null,
  });
});

/** iPad: room status (is laptop online?). */
app.get("/v1/rooms/:roomId", (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found or expired." });
    return;
  }
  res.json({
    roomId: room.id,
    pairCode: room.pairCode,
    agentOnline: agentOnline(room),
    canvasHost: room.canvasHost ?? null,
    waitingJobs: listWaitingJobs(room).length,
  });
});

/** iPad: request a course sync (or list-courses if courseId omitted). */
app.post("/v1/rooms/:roomId/jobs", (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found or expired." });
    return;
  }
  if (!agentOnline(room)) {
    res.status(409).json({
      error:
        "Laptop extension is offline. Open Chrome with the Canvas Bridge extension and stay on Canvas.",
    });
    return;
  }
  const job = createJob(room, { courseId: req.body?.courseId });
  res.status(201).json({
    id: job.id,
    status: job.status,
    courseId: job.courseId ?? null,
    createdAt: job.createdAt,
  });
});

/** iPad: poll job. */
app.get("/v1/rooms/:roomId/jobs/:jobId", (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found or expired." });
    return;
  }
  const job = getJob(room, req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found." });
    return;
  }
  res.json({
    id: job.id,
    status: job.status,
    courseId: job.courseId ?? null,
    error: job.error ?? null,
    payload: job.status === "ready" ? job.payload : null,
    updatedAt: job.updatedAt,
    agentOnline: agentOnline(room),
  });
});

/** Extension heartbeat + optional host discovery. */
app.post("/v1/rooms/:roomId/agent/ping", requireAgent, (req, res) => {
  touchAgent(req.room, req.body?.canvasHost);
  res.json({
    ok: true,
    waiting: listWaitingJobs(req.room).map((j) => ({
      id: j.id,
      courseId: j.courseId ?? null,
      createdAt: j.createdAt,
    })),
  });
});

/** Extension: claim next waiting jobs. */
app.get("/v1/rooms/:roomId/jobs/waiting", requireAgent, (req, res) => {
  touchAgent(req.room, req.query.canvasHost);
  res.json({
    jobs: listWaitingJobs(req.room).map((j) => ({
      id: j.id,
      courseId: j.courseId ?? null,
      createdAt: j.createdAt,
    })),
  });
});

/** Extension: mark running. */
app.post("/v1/rooms/:roomId/jobs/:jobId/running", requireAgent, (req, res) => {
  const job = getJob(req.room, req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found." });
    return;
  }
  markJobRunning(job);
  touchAgent(req.room);
  res.json({ id: job.id, status: job.status });
});

/** Extension: upload completed course payload. */
app.post("/v1/rooms/:roomId/jobs/:jobId/complete", requireAgent, (req, res) => {
  const job = getJob(req.room, req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found." });
    return;
  }
  const payload = req.body?.payload;
  if (!payload || typeof payload !== "object") {
    failJob(job, "Missing payload");
    res.status(400).json({ error: "Missing payload" });
    return;
  }
  completeJob(job, payload);
  touchAgent(req.room, payload.host);
  res.json({ id: job.id, status: job.status, error: job.error ?? null });
});

/** Extension: report failure. */
app.post("/v1/rooms/:roomId/jobs/:jobId/fail", requireAgent, (req, res) => {
  const job = getJob(req.room, req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found." });
    return;
  }
  failJob(job, req.body?.error || "Agent failed");
  touchAgent(req.room);
  res.json({ id: job.id, status: job.status, error: job.error });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

app.listen(PORT, () => {
  console.log(`canvas-bridge listening on :${PORT}`);
});
