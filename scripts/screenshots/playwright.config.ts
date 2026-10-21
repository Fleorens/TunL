// `npm run screenshots` (T36): the public screenshots of docs/screenshots/, taken from the browser UI on the mock's
// demo data. Not part of `npm run review`: run it again when the interface changes, then commit the images.
import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "screenshots.spec.ts",
  fullyParallel: false,
  workers: 1,
});
