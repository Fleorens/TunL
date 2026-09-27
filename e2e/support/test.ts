// Every e2e spec imports `test` and `expect` from here, not from "@playwright/test": the automatic fixture below
// fails any test during which the app printed a console error or warning (React warnings included), which the
// local model cannot see otherwise (lot 2 review).
import { test as base, expect } from "@playwright/test";

export const test = base.extend<{ consoleGuard: undefined }>({
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") {
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
