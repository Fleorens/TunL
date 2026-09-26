import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import { App } from "./App";
import { primeTheme } from "./lib/theme";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("TunL: #root element is missing from index.html");
}

// Apply the theme before the first paint: no flash of the light palette for dark-mode users.
primeTheme("system");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
