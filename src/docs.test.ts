// T39: the public documents exist, link to each other, and agree with the app (licence, version).
import { describe, expect, test } from "vitest";
import changelog from "../CHANGELOG.md?raw";
import contributing from "../CONTRIBUTING.md?raw";
import license from "../LICENSE?raw";
import pkg from "../package.json";
import readme from "../README.md?raw";

/** Files of the repository the documents may link to, by their path from its root. */
const files = new Set(
  Object.keys(
    import.meta.glob([
      "../*.md",
      "../LICENSE",
      "../docs/**/*.md",
      "../tasks/README.md",
      "../docs/screenshots/*.png",
      "../branding/*.svg",
    ]),
  ).map((path) => path.replace(/^\.\.\//, "")),
);

/** The relative links of a Markdown text (`[text](path)` and `src="path"`), anchors and URLs aside. */
function localLinks(markdown: string): string[] {
  const links = [...markdown.matchAll(/\]\(([^)\s]+)\)|src="([^"]+)"/g)].map(
    (m) => m[1] ?? m[2] ?? "",
  );
  return links
    .filter((link) => !/^(https?:|mailto:|#)/.test(link))
    .map((link) => link.split("#")[0] ?? "");
}

describe("LICENSE", () => {
  test("is the GNU GPL v3 text, as D15 and the manifests say", () => {
    expect(license.startsWith("                    GNU GENERAL PUBLIC LICENSE\n")).toBe(true);
    expect(license).toContain("Version 3, 29 June 2007");
    expect(license).toContain("END OF TERMS AND CONDITIONS");
    expect(pkg.license).toBe("GPL-3.0-or-later");
  });
});

describe("README", () => {
  test("every local link and image points to a file of the repository", () => {
    const links = localLinks(readme);
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) {
      expect(files.has(link), link).toBe(true);
    }
  });

  test("says how to install, what TunL needs, and what to do with a blank window", () => {
    for (const text of ["## Install", "## Troubleshooting", "## Build from source", "## License"]) {
      expect(readme).toContain(text);
    }
    expect(readme).toContain("WEBKIT_DISABLE_DMABUF_RENDERER=1");
    expect(readme).toContain("FreeRDP 3");
    expect(readme).toContain("SHA256SUMS");
  });

  test("keeps the progress table the task sheets fill in", () => {
    expect(readme).toContain("## Where it stands");
    expect(readme).toContain("| Works today | Not yet |");
  });
});

describe("CONTRIBUTING", () => {
  test("points to the checks, the rules and the private way to report a security issue", () => {
    for (const link of localLinks(contributing)) {
      expect(files.has(link), link).toBe(true);
    }
    expect(contributing).toContain("npm run review");
    expect(contributing).toContain("AGENTS.md");
    expect(contributing).toContain("security/advisories/new");
  });
});

describe("CHANGELOG", () => {
  test("has an Unreleased section and the app's version", () => {
    expect(changelog).toContain("## [Unreleased]");
    expect(changelog).toContain(`## [${pkg.version}]`);
    expect(changelog).toContain(
      `[${pkg.version}]: https://github.com/Fleorens/TunL/releases/tag/v${pkg.version}`,
    );
  });
});
