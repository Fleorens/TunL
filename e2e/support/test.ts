// Every e2e spec imports `test` and `expect` from here, not from "@playwright/test": the automatic fixture below
// fails any test during which the app printed a console error or warning (React warnings included), which the
// local model cannot see otherwise (lot 2 review).
import { test as base, expect } from "@playwright/test";

// Warnings that say nothing about the app. Motion (dev build only) warns each time `<MotionConfig
// reducedMotion="always">` reduces an animation — which is what "Reduce animations" asks for (T33).
const EXPECTED_WARNINGS = [/^You have Reduced Motion enabled on your device\./];

export const test = base.extend<{ consoleGuard: undefined }>({
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (message) => {
        const expected = EXPECTED_WARNINGS.some((pattern) => pattern.test(message.text()));
        if (message.type() === "error" || (message.type() === "warning" && !expected)) {
          problems.push(`[console.${message.type()}] ${message.text()}`);
        }
      });
      page.on("pageerror", (error) => problems.push(`[pageerror] ${error.message}`));
      await use(undefined);
      expect(problems, "the app printed errors or warnings on the console").toEqual([]);
    },
    { auto: true },
  ],
});

export type { Locator, Page } from "@playwright/test";
export { expect };
