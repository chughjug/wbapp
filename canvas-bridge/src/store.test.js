import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  agentOnline,
  completeJob,
  createJob,
  createRoom,
  getRoomByPairCode,
  listWaitingJobs,
  touchAgent,
} from "./store.js";

describe("canvas-bridge store", () => {
  it("creates a joinable room with a pair code", () => {
    const created = createRoom();
    assert.equal(created.pairCode.length, 6);
    const room = getRoomByPairCode(created.pairCode);
    assert.ok(room);
    assert.equal(room.id, created.roomId);
    assert.equal(room.agentSecret, created.agentSecret);
  });

  it("queues jobs and marks agent online after ping", () => {
    const created = createRoom();
    const room = getRoomByPairCode(created.pairCode);
    touchAgent(room, "school.instructure.com");
    assert.equal(agentOnline(room), true);
    assert.equal(room.canvasHost, "school.instructure.com");

    const job = createJob(room, { courseId: "42" });
    assert.equal(job.status, "waiting");
    assert.equal(listWaitingJobs(room).length, 1);

    completeJob(job, {
      courseId: "42",
      courseName: "Calc",
      host: "school.instructure.com",
      assignments: [],
      files: [],
      syncedAt: Date.now(),
    });
    assert.equal(job.status, "ready");
    assert.equal(listWaitingJobs(room).length, 0);
  });
});
