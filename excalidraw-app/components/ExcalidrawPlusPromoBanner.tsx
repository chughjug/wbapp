import type React from "react";

/**
 * Branding removed: the "Try Excalidraw+ / free trial" promo banner is no
 * longer part of the app shell.
 *
 * This no-op stub only exists until `excalidraw-app/App.tsx` drops its usage
 * (see `excalidraw-app/goodnotes/BRANDING_APP_TSX.md`). Once that edit lands,
 * delete this file.
 */
export const ExcalidrawPlusPromoBanner: React.FC<{
  isSignedIn: boolean;
}> = () => null;
