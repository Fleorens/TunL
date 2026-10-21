// The four screenshots of the AppStream metadata (packaging/linux/*.metainfo.xml), 1280×800, dark theme.
// The mock's own marks (the "Mock backend" badge and its version) are hidden: they are not part of the app.
import { expect, type Page, test } from "@playwright/test";

const OUT = "docs/screenshots";

test.use({ viewport: { width: 1280, height: 800 }, colorScheme: "dark", reducedMotion: "reduce" });

async function open(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("complementary").getByRole("button", { name: /^nas/ }).first(),
  ).toBeVisible();
  await page.addStyleTag({
    content: "footer span:has(> [data-slot='badge']) { visibility: hidden }",
  });
}

async function sidebarRow(page: Page, name: string) {
  return page
    .getByRole("complementary")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first();
}

test("home", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("article").first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/home.png` });
});

/** What the terminal shows: a shell prompt, then a short, colored listing (written straight to the tab's port). */
const TERMINAL_TEXT = [
  "\x1b[2J\x1b[H",
  "\x1b[1;32madmin@nas\x1b[0m:\x1b[1;34m~\x1b[0m$ uptime\r\n",
  " 09:41:07 up 23 days,  4:12,  1 user,  load average: 0.08, 0.11, 0.09\r\n",
  "\x1b[1;32madmin@nas\x1b[0m:\x1b[1;34m~\x1b[0m$ ls -l /srv\r\n",
  "total 16\r\n",
  "drwxr-xr-x 6 admin admin 4096 Oct 18 21:04 \x1b[1;34mbackups\x1b[0m\r\n",
  "drwxr-xr-x 3 admin admin 4096 Oct 12 08:30 \x1b[1;34mmedia\x1b[0m\r\n",
  "-rwxr-xr-x 1 admin admin  812 Sep 30 17:55 \x1b[1;32mrotate-logs.sh\x1b[0m\r\n",
  "-rw-r--r-- 1 admin admin 2291 Oct 20 09:12 notes.md\r\n",
  "\x1b[1;32madmin@nas\x1b[0m:\x1b[1;34m~\x1b[0m$ df -h /srv\r\n",
  "Filesystem      Size  Used Avail Use% Mounted on\r\n",
  "/dev/md0        7.3T  4.1T  3.2T  57% /srv\r\n",
  "\x1b[1;32madmin@nas\x1b[0m:\x1b[1;34m~\x1b[0m$ ",
].join("");

test("terminal", async ({ page }) => {
  await open(page);
  await (await sidebarRow(page, "nas")).dblclick();
  const view = page.getByRole("region", { name: "nas", exact: true });
  await expect(view.locator(".xterm-rows")).toContainText("nas");
  await page.evaluate(async (text) => {
    // The same module instances as the app (Vite serves them by URL).
    const { useSessions } = await import("/src/features/sessions/store.ts");
    const { getSessionPort } = await import("/src/features/sessions/session-ports.ts");
    const id = useSessions.getState().sessions[0]?.id ?? "";
    getSessionPort(id)?.push(new TextEncoder().encode(text));
  }, TERMINAL_TEXT);
  await expect(view.locator(".xterm-rows")).toContainText("/dev/md0");
  await page.screenshot({ path: `${OUT}/terminal.png` });
});

test("sftp", async ({ page }) => {
  await open(page);
  await (await sidebarRow(page, "nas")).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
  const view = page.getByRole("region", { name: "nas", exact: true });
  await expect(view.getByRole("table", { name: "Files" })).toBeVisible();
  await view.getByRole("button", { name: "Upload files" }).click();
  await expect(view.getByRole("list", { name: "Transfers" })).toContainText("Done");
  await expect(view.getByRole("table", { name: "Files" })).toContainText("report.pdf");
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${OUT}/sftp.png` });
});

test("editor", async ({ page }) => {
  await open(page);
  await (await sidebarRow(page, "web-01")).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/editor.png` });
});
