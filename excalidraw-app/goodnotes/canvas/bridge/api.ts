/**
 * iPad HTTP client for the Heroku canvas-bridge relay.
 */

import { applyBridgePayload } from "./importPayload";
import { getBridgeUrl } from "./config";
import { loadBridgeSession, saveBridgeSession } from "./session";

import type { BridgeImportResult } from "./importPayload";
import type { BridgeJobView, BridgeSession } from "./types";

export class BridgeError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "BridgeError";
  }
}

const request = async <T>(
  path: string,
  init?: RequestInit,
  bridgeUrl = getBridgeUrl(),
): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`${bridgeUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new BridgeError(
      "Could not reach the Canvas bridge. Is the laptop extension online and the bridge URL correct?",
    );
  }

  if (!response.ok) {
    let message = `Bridge returned ${response.status}.`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) {
        message = body.error;
      }
    } catch {
      // ignore
    }
    throw new BridgeError(message, response.status);
  }

  return (await response.json()) as T;
};

export const joinBridgeRoom = async (
  pairCode: string,
  bridgeUrl = getBridgeUrl(),
): Promise<BridgeSession> => {
  const code = pairCode.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (code.length < 4) {
    throw new BridgeError(
      "Enter the 6-character code from the Chrome extension.",
    );
  }

  const joined = await request<{
    roomId: string;
    pairCode: string;
    agentOnline: boolean;
    canvasHost: string | null;
  }>(
    "/v1/rooms/join",
    { method: "POST", body: JSON.stringify({ pairCode: code }) },
    bridgeUrl,
  );

  const session: BridgeSession = {
    roomId: joined.roomId,
    pairCode: joined.pairCode,
    bridgeUrl,
    canvasHost: joined.canvasHost,
    joinedAt: Date.now(),
  };
  saveBridgeSession(session);
  return session;
};

export const getBridgeRoomStatus = async (session = loadBridgeSession()) => {
  if (!session) {
    throw new BridgeError("Not paired with a laptop yet.");
  }
  return request<{
    roomId: string;
    pairCode: string;
    agentOnline: boolean;
    canvasHost: string | null;
    waitingJobs: number;
  }>(`/v1/rooms/${session.roomId}`, undefined, session.bridgeUrl);
};

export type BridgeJobRequest = {
  courseId?: string;
  /** When set with courseId, laptop returns bytes for these files only. */
  fileIds?: string[];
};

/** Request a courses list, a course catalog, or a file-bytes chunk. */
export const createBridgeJob = async (
  input?: string | BridgeJobRequest,
  session = loadBridgeSession(),
) => {
  if (!session) {
    throw new BridgeError("Not paired with a laptop yet.");
  }
  const body: BridgeJobRequest =
    typeof input === "string"
      ? { courseId: input }
      : input && typeof input === "object"
      ? input
      : {};

  return request<{
    id: string;
    status: string;
    courseId: string | null;
    fileIds: string[] | null;
    createdAt: number;
  }>(
    `/v1/rooms/${session.roomId}/jobs`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    session.bridgeUrl,
  );
};

export const getBridgeJob = async (
  jobId: string,
  session = loadBridgeSession(),
): Promise<BridgeJobView> => {
  if (!session) {
    throw new BridgeError("Not paired with a laptop yet.");
  }
  return request<BridgeJobView>(
    `/v1/rooms/${session.roomId}/jobs/${jobId}`,
    undefined,
    session.bridgeUrl,
  );
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Create a job and poll until ready/error. Typical iPad → laptop round trip.
 */
export const runBridgeSync = async (
  input?: string | BridgeJobRequest,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    onStatus?: (job: BridgeJobView) => void;
  } = {},
): Promise<BridgeJobView> => {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const intervalMs = options.intervalMs ?? 1500;
  const created = await createBridgeJob(input);
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const job = await getBridgeJob(created.id);
    options.onStatus?.(job);
    if (job.status === "ready" || job.status === "error") {
      return job;
    }
    await sleep(intervalMs);
  }

  throw new BridgeError(
    "Timed out waiting for the laptop. Is the Chrome extension open with Canvas logged in?",
  );
};

const FILE_CHUNK_SIZE = 4;

/**
 * Pull a full course: catalog first, then download every file in chunks into
 * the course folder on the iPad.
 */
export const runBridgeCoursePull = async (
  courseId: string,
  options: {
    onStatus?: (message: string) => void;
    onJob?: (job: BridgeJobView) => void;
  } = {},
): Promise<BridgeImportResult> => {
  options.onStatus?.("Asking laptop for the course catalog…");
  const catalogJob = await runBridgeSync(courseId, {
    onStatus: options.onJob,
  });
  if (catalogJob.status === "error" || !catalogJob.payload) {
    throw new BridgeError(catalogJob.error || "Course sync failed.");
  }

  let result = await applyBridgePayload(catalogJob.payload, {
    importPdfs: true,
    onProgress: options.onStatus,
  });

  let pending = [...(result.pendingFileIds || [])];
  let chunkIndex = 0;
  const total = pending.length;

  while (pending.length > 0) {
    const fileIds = pending.slice(0, FILE_CHUNK_SIZE);
    pending = pending.slice(FILE_CHUNK_SIZE);
    chunkIndex += 1;
    const done = Math.min(chunkIndex * FILE_CHUNK_SIZE, total);
    options.onStatus?.(
      `Downloading files ${Math.min(done, total)}/${total} into ${
        result.courseLabel || "course folder"
      }…`,
    );

    const chunkJob = await runBridgeSync(
      { courseId, fileIds },
      { onStatus: options.onJob, timeoutMs: 180_000 },
    );
    if (chunkJob.status === "error" || !chunkJob.payload) {
      throw new BridgeError(
        chunkJob.error || `File download failed (${fileIds.join(", ")}).`,
      );
    }

    const chunkResult = await applyBridgePayload(chunkJob.payload, {
      importPdfs: true,
      onProgress: options.onStatus,
    });
    result = {
      ...result,
      filesImported: result.filesImported + chunkResult.filesImported,
      filesPlaceholder:
        result.filesPlaceholder + chunkResult.filesPlaceholder,
      notebooksCreated:
        result.notebooksCreated + chunkResult.notebooksCreated,
      notebooksUpdated:
        result.notebooksUpdated + chunkResult.notebooksUpdated,
      courseLabel: result.courseLabel || chunkResult.courseLabel,
      pendingFileIds: pending,
    };
  }

  options.onStatus?.(
    `Done — ${result.filesImported} PDFs and ${result.filesPlaceholder} other files in “${
      result.courseLabel || "course"
    }”.`,
  );
  return result;
};
