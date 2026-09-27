// Generic checks that any screen must pass. They catch, without eyes, the layout and wording defects found by the
// orchestrator's screenshots in lot 2: raw i18n keys, horizontal overflow, controls without an accessible name,
// controls overlapping each other in a dialog, form fields glued to a dialog's edge.
import { readFileSync } from "node:fs";
import { expect, type Page } from "./test.ts";

const NAMESPACES = Object.keys(JSON.parse(readFileSync("src/i18n/locales/en.json", "utf8")));

export async function expectSaneUi(page: Page): Promise<void> {
  const problems = await page.evaluate((namespaces: string[]) => {
    const found: string[] = [];
    const rawKey = new RegExp(`^(${namespaces.join("|")})\\.[A-Za-z0-9_.]+$`);
    const shown = (el: Element) => {
      if (el.closest("[aria-hidden='true'], [hidden], [data-state='closed']")) return false;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return (
        style.visibility !== "hidden" && style.opacity !== "0" && box.width > 0 && box.height > 0
      );
    };
    const describe = (el: Element) =>
      `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}> "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}"`;

    // 1. Raw i18n keys on screen.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim() ?? "";
      if (rawKey.test(text) && node.parentElement && shown(node.parentElement))
        found.push(`raw i18n key on screen: ${text}`);
    }

    // 2. Horizontal overflow of the page.
    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      found.push(
        `page wider than the window: ${document.documentElement.scrollWidth}px > ${window.innerWidth}px`,
      );
    }

    // 3. Controls without an accessible name.
    const controls = [
      ...document.querySelectorAll(
        "button, input:not([type='hidden']), textarea, select, [role='combobox'], [role='checkbox'], [role='radio'], [role='switch'], [role='tab']",
      ),
    ].filter(shown);
    const nameOf = (el: Element) => {
      const labelledBy = el.getAttribute("aria-labelledby");
      const byIds = labelledBy
        ?.split(" ")
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      const labels =
        "labels" in el
          ? [...((el as HTMLInputElement).labels ?? [])].map((l) => l.textContent).join(" ")
          : "";
      const wrapping = el.closest("label")?.textContent ?? "";
      return [
        el.getAttribute("aria-label"),
        byIds,
        labels,
        wrapping,
        el.textContent,
        el.getAttribute("title"),
        el.getAttribute("placeholder"),
      ]
        .map((part) => part?.trim() ?? "")
        .find((part) => part !== "");
    };
    for (const el of controls)
      if (!nameOf(el)) found.push(`control without an accessible name: ${describe(el)}`);

    // 4 and 5. Inside each open dialog: no overlapping controls, form fields keep a side margin.
    for (const dialog of document.querySelectorAll("[role='dialog'], [role='alertdialog']")) {
      if (!shown(dialog)) continue;
      const frame = dialog.getBoundingClientRect();
      const inside = controls.filter((el) => dialog.contains(el));
      inside.forEach((a, i) => {
        for (const b of inside.slice(i + 1)) {
          if (a.contains(b) || b.contains(a)) continue;
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (w > 2 && h > 2) found.push(`overlapping controls: ${describe(a)} and ${describe(b)}`);
        }
      });
      for (const el of inside.filter((c) => c.matches("input, textarea, [role='combobox']"))) {
        const box = el.getBoundingClientRect();
        if (box.left - frame.left < 8 || frame.right - box.right < 8) {
          found.push(`field glued to the dialog edge (< 8px): ${describe(el)}`);
        }
      }
    }
    return found;
  }, NAMESPACES);
  expect(problems, "generic UI checks (e2e/support/sanity.ts)").toEqual([]);
}
