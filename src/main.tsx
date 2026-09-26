import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import { App } from "./App";
import { disableNativeContextMenu } from "./lib/native-context-menu";
import { primeTheme } from "./lib/theme";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("TunL: #root element is missing from index.html");
}

// Apply the theme before the first paint: no flash of the light palette for dark-mode users.
primeTheme("system");

// In production, suppress WebKit's native context menu everywhere except text fields
// so the app's own context menus are the only ones. In dev, keep the native menu:
// it gives access to the browser inspector.
if (import.meta.env.PROD) {
  disableNativeContextMenu();
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
