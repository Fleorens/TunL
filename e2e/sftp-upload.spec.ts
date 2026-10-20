// T26b: uploads, from the toolbar's file chooser (mock: report.pdf and notes.txt) and by dropping files on the list.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
  await expect(names(page).first()).toHaveText("projects");
});

function nas(page: Page) {
  return page.getByRole("region", { name: "nas", exact: true });
}

function names(page: Page) {
  return nas(page).getByRole("table", { name: "Files" }).locator("tbody tr td:first-child");
}

function transfers(page: Page) {
  return nas(page).getByRole("list", { name: "Transfers" });
}

test("Upload files sends what was chosen, beside an existing name, then lists it", async ({
  page,
}) => {
  await nas(page).getByRole("button", { name: "Upload files" }).click();
  await expect(transfers(page).getByRole("listitem", { name: "report.pdf" })).toContainText("Done");
  await expect(transfers(page).getByRole("listitem", { name: "notes.txt" })).toContainText("Done");
  await expect(names(page)).toContainText(["notes (1).txt", "notes.txt", "report.pdf"]);
  // An upload has nothing to show in a local folder.
  await expect(transfers(page).getByRole("button", { name: /in its folder/ })).toHaveCount(0);
});

test("dropping files on the list shows where they go, then uploads them", async ({ page }) => {
  const list = nas(page).getByRole("table", { name: "Files" });
  const files = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "photo.jpg"));
    return transfer;
  });
  await list.dispatchEvent("dragover", { dataTransfer: files });
  await expect(nas(page).getByText("Drop to upload to /home/admin")).toBeVisible();
  await expectSaneUi(page);
  await list.dispatchEvent("drop", { dataTransfer: files });
  await expect(nas(page).getByText("Drop to upload to /home/admin")).toHaveCount(0);
  await expect(transfers(page).getByRole("listitem", { name: "photo.jpg" })).toContainText("Done");
  await expect(names(page)).toContainText(["photo.jpg"]);
});

test("a drag that is not files changes nothing", async ({ page }) => {
  const list = nas(page).getByRole("table", { name: "Files" });
  const text = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "hello");
    return transfer;
  });
  await list.dispatchEvent("dragover", { dataTransfer: text });
  await expect(nas(page).getByText(/Drop to upload/)).toHaveCount(0);
});
