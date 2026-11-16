/**
 * The library's theme, shared with anything that portals out of the shelf.
 *
 * A popover rendered into `document.body` leaves the `.excalidraw` /
 * `.theme--dark` subtree that declares every colour token, so it has to
 * re-declare them — which means it has to know the theme without being handed
 * it through five layers of props.
 */

import { createContext, useContext } from "react";

export type ShelfTheme = "light" | "dark";

export const ShelfThemeContext = createContext<ShelfTheme>("light");

export const useShelfTheme = (): ShelfTheme => useContext(ShelfThemeContext);
