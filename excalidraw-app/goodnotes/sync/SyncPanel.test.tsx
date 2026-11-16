/**
 * Panel tests — the accessibility contract, mostly: labelled controls, a
 * live region that exists before it has anything to say, and nothing at all
 * on screen when sync is unconfigured.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SyncPanel } from "./SyncPanel";

import type { SyncStatus } from "./types";
import type { UseSyncResult } from "./useSync";

const makeSync = (status: Partial<SyncStatus> = {}): UseSyncResult => ({
  status: {
    configured: true,
    phase: "signed-out",
    email: null,
    userId: null,
    lastSyncedAt: null,
    pending: 0,
    deferred: [],
    conflicts: [],
    error: null,
    ...status,
  },
  syncNow: vi.fn(async () => undefined),
  signIn: vi.fn(async () => undefined),
  signUp: vi.fn(async () => ({ needsConfirmation: false })),
  signOut: vi.fn(async () => undefined),
  dismissConflicts: vi.fn(),
  authError: null,
  clearAuthError: vi.fn(),
  busy: false,
});

describe("<SyncPanel />", () => {
  it("renders nothing when sync is not configured", () => {
    const { container } = render(
      <SyncPanel sync={makeSync({ configured: false, phase: "disabled" })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("explains itself when asked to show while unconfigured", () => {
    render(
      <SyncPanel
        sync={makeSync({ configured: false, phase: "disabled" })}
        showWhenUnconfigured
      />,
    );
    expect(screen.getByText("Sync is off for this app")).toBeInTheDocument();
  });

  it("offers a labelled sign-in form when signed out", () => {
    render(<SyncPanel sync={makeSync({ pending: 3 })} />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(
      screen.getByText("3 notebooks are saved on this device only."),
    ).toBeInTheDocument();
  });

  it("keeps the status in a live region, not only in colour", () => {
    const { container } = render(
      <SyncPanel
        sync={makeSync({ phase: "offline", userId: "u", email: "a@b.c" })}
      />,
    );
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toBeTruthy();
    expect(live?.textContent).toContain("Offline");
    // the dot carries no information of its own
    expect(container.querySelector(".gn-sync__dot")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("names the conflict copy and where it came from", () => {
    render(
      <SyncPanel
        sync={makeSync({
          phase: "idle",
          userId: "u",
          email: "a@b.c",
          conflicts: [
            {
              at: Date.now(),
              docId: "doc-1",
              copyId: "doc-2",
              copyTitle: "Lecture 4 (conflict from iPad)",
              fromDevice: "iPad",
            },
          ],
        })}
      />,
    );
    expect(
      screen.getByText(/Lecture 4 \(conflict from iPad\)/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });
});
