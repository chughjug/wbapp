// TEMPORARY dev harness for verifying ImportPdfDialog in the running app.
// Deleted before hand-off; not part of the public API.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";

import { ImportPdfDialog } from "./ImportPdfDialog";

const Harness = ({ api, theme }: { api: any; theme: "light" | "dark" }) => {
  const [open, setOpen] = useState(true);
  return open ? (
    <ImportPdfDialog
      excalidrawAPI={api}
      theme={theme}
      onClose={() => {
        setOpen(false);
        (window as any).__dialogClosed = true;
      }}
      onImported={(r) => {
        (window as any).__imported = {
          pages: r.pages.length,
          files: Object.keys(r.files).length,
        };
      }}
    />
  ) : null;
};

(window as any).__mountImportPdfDialog = (theme: "light" | "dark" = "light") => {
  const scene: any = { elements: [], files: {} };
  const api = {
    getAppState: () => ({ theme }),
    getSceneElements: () => scene.elements,
    addFiles: (files: any[]) => {
      for (const f of files) {
        scene.files[f.id] = f;
      }
    },
    updateScene: ({ elements }: any) => {
      scene.elements = elements;
    },
    setViewport: () => true,
  };
  (window as any).__scene = scene;
  const host = document.createElement("div");
  document.body.appendChild(host);
  createRoot(host).render(<Harness api={api} theme={theme} />);
};
