/**
 * iPad pairing + sync controls for the laptop Chrome extension path.
 */

import React, { useCallback, useEffect, useId, useState } from "react";

import {
  BridgeError,
  getBridgeRoomStatus,
  joinBridgeRoom,
  runBridgeCoursePull,
  runBridgeSync,
} from "./api";
import {
  bridgeCoursesAsCanvas,
  clearBridgeCache,
  loadCoursePayload,
  subscribeBridgeCache,
} from "./cache";
import { getBridgeUrl, setBridgeUrlOverride } from "./config";
import { applyBridgePayload } from "./importPayload";
import {
  clearBridgeSession,
  isBridgePaired,
  loadBridgeSession,
  subscribeBridgeSession,
} from "./session";

import type { BridgeCourseSummary } from "./types";

export interface BridgePairPanelProps {
  onPaired?: () => void;
  onSynced?: () => void;
}

export const BridgePairPanel: React.FC<BridgePairPanelProps> = ({
  onPaired,
  onSynced,
}) => {
  const codeId = useId();
  const urlId = useId();
  const statusId = useId();

  const [pairCode, setPairCode] = useState("");
  const [bridgeUrl, setBridgeUrl] = useState(() => getBridgeUrl());
  const [session, setSession] = useState(() => loadBridgeSession());
  const [courses, setCourses] = useState<BridgeCourseSummary[]>(() =>
    bridgeCoursesAsCanvas().map((c) => ({
      id: c.id,
      name: c.name,
      courseCode: c.course_code,
    })),
  );
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const refresh = () => {
      setSession(loadBridgeSession());
      setCourses(
        bridgeCoursesAsCanvas().map((c) => ({
          id: c.id,
          name: c.name,
          courseCode: c.course_code,
        })),
      );
    };
    const u1 = subscribeBridgeSession(refresh);
    const u2 = subscribeBridgeCache(refresh);
    return () => {
      u1();
      u2();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setAgentOnline(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const room = await getBridgeRoomStatus(session);
        if (!cancelled) {
          setAgentOnline(room.agentOnline);
        }
      } catch {
        if (!cancelled) {
          setAgentOnline(false);
        }
      }
    };
    void tick();
    const id = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [session]);

  useEffect(() => {
    if (!selectedCourseId && courses.length > 0) {
      setSelectedCourseId(courses[0].id);
    }
  }, [courses, selectedCourseId]);

  const onJoin = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      setStatus("Joining laptop…");
      try {
        setBridgeUrlOverride(bridgeUrl);
        const joined = await joinBridgeRoom(pairCode, bridgeUrl.trim());
        setSession(joined);
        setStatus(
          joined.canvasHost
            ? `Paired. Laptop Canvas: ${joined.canvasHost}`
            : "Paired. Keep the Chrome extension open.",
        );
        onPaired?.();
      } catch (caught) {
        setError(
          caught instanceof BridgeError
            ? caught.message
            : "Could not join the laptop.",
        );
        setStatus("");
      } finally {
        setBusy(false);
      }
    },
    [bridgeUrl, pairCode, onPaired],
  );

  const syncCourses = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStatus("Asking laptop for your courses…");
    try {
      const job = await runBridgeSync(undefined, {
        onStatus: (j) => {
          if (j.status === "waiting") {
            setStatus("Waiting for laptop extension…");
          } else if (j.status === "running") {
            setStatus("Laptop is reading Canvas…");
          }
        },
      });
      if (job.status === "error" || !job.payload) {
        throw new BridgeError(job.error || "Sync failed.");
      }
      const result = await applyBridgePayload(job.payload, {
        onProgress: setStatus,
      });
      setCourses(
        bridgeCoursesAsCanvas().map((c) => ({
          id: c.id,
          name: c.name,
          courseCode: c.course_code,
        })),
      );
      setStatus(
        result.coursesCached != null
          ? `Got ${result.coursesCached} courses from your laptop.`
          : "Courses synced.",
      );
      onSynced?.();
    } catch (caught) {
      setError(
        caught instanceof BridgeError ? caught.message : "Course sync failed.",
      );
      setStatus("");
    } finally {
      setBusy(false);
    }
  }, [onSynced]);

  const syncCourse = useCallback(async () => {
    if (!selectedCourseId) {
      setError("Pick a course first (sync the course list if it’s empty).");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus("Pulling course files into a folder…");
    try {
      const result = await runBridgeCoursePull(selectedCourseId, {
        onStatus: setStatus,
        onJob: (j) => {
          if (j.status === "waiting") {
            setStatus("Waiting for laptop extension…");
          } else if (j.status === "running") {
            setStatus("Laptop is reading Canvas files…");
          }
        },
      });
      setCourses(
        bridgeCoursesAsCanvas().map((c) => ({
          id: c.id,
          name: c.name,
          courseCode: c.course_code,
        })),
      );
      setStatus(
        result.courseLabel
          ? `Saved to folder “${result.courseLabel}”: ${result.filesImported} PDFs, ${result.filesPlaceholder} other files, ${result.notebooksCreated} assignment notebooks.`
          : "Course synced.",
      );
      onSynced?.();
    } catch (caught) {
      setError(
        caught instanceof BridgeError ? caught.message : "Course sync failed.",
      );
      setStatus("");
    } finally {
      setBusy(false);
    }
  }, [selectedCourseId, onSynced]);

  const onUnpair = useCallback(() => {
    clearBridgeSession();
    clearBridgeCache();
    setSession(null);
    setCourses([]);
    setSelectedCourseId("");
    setStatus("Unpaired.");
    setError(null);
  }, []);

  if (session || isBridgePaired()) {
    const active = session ?? loadBridgeSession();
    const cachedCourse = selectedCourseId
      ? loadCoursePayload(selectedCourseId)
      : null;
    return (
      <div className="gn-canvas-bridge">
        <p className="gn-canvas-lede">
          Paired with code <strong>{active?.pairCode}</strong>. Keep the Chrome
          extension open on your laptop with Canvas logged in.
        </p>
        <p className="gn-canvas-hint" id={statusId}>
          Laptop:{" "}
          {agentOnline == null
            ? "checking…"
            : agentOnline
            ? "online"
            : "offline — open the extension"}
          {active?.canvasHost ? ` · ${active.canvasHost}` : null}
        </p>

        <div className="gn-canvas-actions" style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            className="gn-canvas-button gn-canvas-button--primary"
            disabled={busy}
            onClick={() => void syncCourses()}
          >
            {busy ? "Working…" : "Sync course list"}
          </button>
          <button
            type="button"
            className="gn-canvas-button gn-canvas-button--quiet"
            disabled={busy}
            onClick={onUnpair}
          >
            Unpair
          </button>
        </div>

        {courses.length > 0 ? (
          <div className="gn-canvas-field" style={{ marginTop: "0.75rem" }}>
            <label htmlFor={`${codeId}-course`}>Course to pull</label>
            <select
              id={`${codeId}-course`}
              className="gn-canvas-input"
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              disabled={busy}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.courseCode ? `${c.courseCode} — ${c.name}` : c.name}
                </option>
              ))}
            </select>
            <div className="gn-canvas-actions" style={{ marginTop: "0.5rem" }}>
              <button
                type="button"
                className="gn-canvas-button gn-canvas-button--primary"
                disabled={busy || !selectedCourseId}
                onClick={() => void syncCourse()}
              >
                {busy
                  ? "Pulling files…"
                  : cachedCourse
                  ? "Re-pull all files"
                  : "Pull all files to folder"}
              </button>
            </div>
          </div>
        ) : (
          <p className="gn-canvas-hint">
            Sync the course list first, then pull one course’s assignments and
            PDFs onto this iPad.
          </p>
        )}

        {error ? (
          <p className="gn-canvas-alert" role="alert">
            {error}
          </p>
        ) : null}
        {status ? (
          <p className="gn-canvas-success" role="status">
            {status}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form className="gn-canvas-form gn-canvas-bridge" onSubmit={onJoin}>
      <p className="gn-canvas-lede">
        On your laptop: open Chrome, load the{" "}
        <strong>wbapp Canvas Bridge</strong> extension, stay logged into Canvas,
        then enter the pairing code here.
      </p>

      <div className="gn-canvas-field">
        <label htmlFor={codeId}>Pairing code</label>
        <input
          id={codeId}
          className="gn-canvas-input"
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="ABC123"
          value={pairCode}
          onChange={(e) => {
            setPairCode(e.target.value.toUpperCase());
            setError(null);
          }}
          maxLength={8}
        />
      </div>

      <div className="gn-canvas-field">
        <label htmlFor={urlId}>Bridge URL</label>
        <input
          id={urlId}
          className="gn-canvas-input"
          type="url"
          spellCheck={false}
          value={bridgeUrl}
          onChange={(e) => setBridgeUrl(e.target.value)}
        />
        <p className="gn-canvas-hint">
          Your Heroku relay, e.g. https://your-app.herokuapp.com — same URL as
          in the extension popup.
        </p>
      </div>

      {error ? (
        <p className="gn-canvas-alert" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="gn-canvas-success" role="status">
          {status}
        </p>
      ) : null}

      <div className="gn-canvas-actions">
        <span className="gn-canvas-actions__spacer" />
        <button
          type="submit"
          className="gn-canvas-button gn-canvas-button--primary"
          disabled={busy || pairCode.trim().length < 4}
        >
          {busy ? "Pairing…" : "Pair with laptop"}
        </button>
      </div>
    </form>
  );
};
