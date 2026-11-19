import React from "react";

import { Excalidraw } from "../index";

import { act, fireEvent, render, waitFor } from "./test-utils";

const { h } = window;

/**
 * `LayerUI` renders the toast only in its non-phone branch, so for a long
 * time `setToast` was silently invisible on a phone — the screen where a
 * one-line message matters most. `MobileMenu` renders it too now; this
 * pins that, since nothing else in the suite renders a toast on a phone.
 */
describe("toast on a phone", () => {
  const renderAt = async (formFactor: "phone" | "desktop") => {
    await render(
      <Excalidraw UIOptions={{ getFormFactor: () => formFactor }} />,
    );
    fireEvent.resize(window);
    await waitFor(() =>
      expect(h.app.editorInterface.formFactor).toBe(formFactor),
    );
  };

  const showToast = (message: string) => {
    act(() => {
      h.setState({ toast: { message, closable: true } });
    });
  };

  it("shows a toast", async () => {
    await renderAt("phone");
    expect(document.querySelector(".Toast")).toBe(null);

    showToast("Page 3 — where “entropy” appears");

    await waitFor(() => {
      const toast = document.querySelector(".Toast");
      expect(toast).not.toBe(null);
      expect(toast!.textContent).toContain("Page 3");
    });
  });

  it("still shows one on a desktop", async () => {
    await renderAt("desktop");
    showToast("hello");
    await waitFor(() =>
      expect(document.querySelector(".Toast")).not.toBe(null),
    );
  });

  it("closes when dismissed", async () => {
    await renderAt("phone");
    showToast("hello");
    await waitFor(() =>
      expect(document.querySelector(".Toast")).not.toBe(null),
    );

    const close = document.querySelector<HTMLElement>(".Toast button.close");
    expect(close).not.toBe(null);
    fireEvent.click(close!);

    await waitFor(() => expect(document.querySelector(".Toast")).toBe(null));
  });
});
