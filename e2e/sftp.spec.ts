// T25: an SFTP tab and its explorer, over the mock file system of T24 (nas: user admin, home /home/admin).
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function openSftp(page: Page, name: string) {
  await page
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
}

function view(page: Page, title: string) {
  return page.getByRole("region", { name: title, exact: true });
}

function files(page: Page, title: string) {
  return view(page, title).getByRole("table", { name: "Files" });
}

function names(page: Page, title: string) {
  return files(page, title).locator("tbody tr td:first-child");
}

test("an SFTP tab opens in the home directory, folders first", async ({ page }) => {
  await openSftp(page, "nas");
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas");
  await expect(names(page, "nas")).toHaveText(["projects", "backup.tar.gz", "current", "notes.txt"]);
  await expect(view(page, "nas").getByRole("navigation")).toContainText("home");
  await expect(view(page, "nas").getByRole("navigation")).toContainText("admin");
  await expect(page.getByRole("contentinfo")).toContainText("sftp");
  await expectSaneUi(page);
});

test("hidden files, sorting, and the size column", async ({ page }) => {
  await openSftp(page, "nas");
  const nas = view(page, "nas");
  await expect(names(page, "nas")).not.toContainText([".bashrc"]);
  await nas.getByRole("button", { name: "Show hidden files" }).click();
  await expect(names(page, "nas").first()).toHaveText("projects");
  await expect(names(page, "nas").nth(1)).toHaveText(".bashrc");

  await nas.getByRole("button", { name: "Size" }).click();
  await nas.getByRole("button", { name: "Size" }).click();
  await expect(nas.getByRole("columnheader", { name: "Size" })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await expect(names(page, "nas").nth(1)).toHaveText("backup.tar.gz");
  await expect(files(page, "nas").getByRole("row", { name: /backup\.tar\.gz/ })).toContainText(
    "700 MB",
  );
});

test("double-click enters a folder; the breadcrumb and Up go back", async ({ page }) => {
  await openSftp(page, "nas");
  const nas = view(page, "nas");
  await files(page, "nas").getByRole("row", { name: /projects/ }).dblclick();
  await expect(names(page, "nas")).toHaveText(["app", "README.md"]);
  await expect(nas.getByRole("navigation")).toContainText("projects");

  await nas.getByRole("navigation").getByRole("button", { name: "home" }).click();
  await expect(names(page, "nas")).toHaveText(["admin"]);

  await nas.getByRole("button", { name: "Parent folder" }).click();
  await expect(names(page, "nas")).toContainText(["etc", "home", "var"]);
});

test("the keyboard moves, opens, and goes up", async ({ page }) => {
  await openSftp(page, "nas");
  await expect(names(page, "nas").first()).toHaveText("projects");
  await files(page, "nas").getByRole("row", { name: /projects/ }).click();
  await page.keyboard.press("Enter");
  await expect(names(page, "nas")).toHaveText(["app", "README.md"]);
  await files(page, "nas").getByRole("row", { name: /app/ }).click();
  await page.keyboard.press("ArrowDown");
  await expect(files(page, "nas").getByRole("row", { name: /README/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Backspace");
  await expect(names(page, "nas").first()).toHaveText("projects");
});

test("a typed path is resolved; a wrong one says so and stays put", async ({ page }) => {
  await openSftp(page, "nas");
  const nas = view(page, "nas");
  await nas.getByRole("button", { name: "Type a path" }).click();
  await nas.getByRole("textbox", { name: "Path" }).fill("/var/www/html/../html");
  await page.keyboard.press("Enter");
  await expect(names(page, "nas")).toHaveText(["assets", "index.html"]);

  await nas.getByRole("button", { name: "Type a path" }).click();
  await nas.getByRole("textbox", { name: "Path" }).fill("/nowhere");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/not found/i)).toBeVisible();
  await expect(names(page, "nas")).toHaveText(["assets", "index.html"]);
});

test("an SFTP tab through a bastion shows its steps, then the files", async ({ page }) => {
  await openSftp(page, "web-01");
  await expect(view(page, "web-01").getByRole("status")).toContainText("Through bastion-01");
  await expect(names(page, "web-01")).toContainText(["projects"]);
});
