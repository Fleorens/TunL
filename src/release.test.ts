// T37: the CI and release workflows, read as text (Vite `?raw`): what they run, and how they are locked down.
import { describe, expect, test } from "vitest";
import ci from "../.github/workflows/ci.yml?raw";
import release from "../.github/workflows/release.yml?raw";
import pkg from "../package.json";
import cargoToml from "../src-tauri/Cargo.toml?raw";
import tauri from "../src-tauri/tauri.conf.json";

const WORKFLOWS = { ci, release };

describe("both workflows", () => {
  test.each(Object.entries(WORKFLOWS))(
    "%s pins every action to a commit, its tag in a comment",
    (_, text) => {
      const uses = text.split("\n").filter((line) => /^\s*-?\s*uses:/.test(line));
      expect(uses.length).toBeGreaterThan(0);
      for (const line of uses) {
        expect(line, line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # \S+$/);
      }
    },
  );

  test.each(Object.entries(WORKFLOWS))("%s gives each job a timeout", (_, text) => {
    const jobsPart = text.slice(text.indexOf("\njobs:\n"));
    const jobs = jobsPart.split("\n").filter((line) => /^ {2}[\w-]+:$/.test(line));
    const timeouts = text.split("\n").filter((line) => /^ {4}timeout-minutes: \d+$/.test(line));
    expect(timeouts.length).toBe(jobs.length);
  });
});

describe("CI", () => {
  test("runs on main and on pull requests, with read-only access", () => {
    expect(ci).toMatch(/on:\n {2}push:\n {4}branches: \[main\]\n {2}pull_request:/);
    expect(ci).toMatch(/permissions:\n {2}contents: read/);
  });

  test("runs the whole recipe, both audits and the packaging checks", () => {
    expect(ci).toContain("run: npm ci");
    expect(ci).toContain("run: npm run review");
    expect(ci).toContain("npm audit --omit=dev --audit-level=high");
    expect(ci).toContain("cargo audit");
    expect(ci).toContain("scripts/check-packaging.sh");
  });
});

describe("release", () => {
  test("only a v* tag builds, and the result is a draft", () => {
    expect(release).toMatch(/on:\n {2}push:\n {4}tags: \["v\*"\]/);
    expect(release).toContain("draft: true");
    expect(release).not.toMatch(/branches:/);
  });

  test("checks the tag against the version, builds the three packages, publishes their checksums", () => {
    expect(release).toContain('node scripts/check-version.mjs "${GITHUB_REF_NAME}"');
    expect(release).toContain("npx tauri build --bundles deb,rpm,appimage");
    expect(release).toContain("SHA256SUMS");
  });
});

describe("what ships", () => {
  test("the build tools are dev dependencies: they are not audited as part of the app", () => {
    for (const tool of ["shadcn", "tailwindcss", "@tailwindcss/vite"]) {
      expect(Object.keys(pkg.dependencies), tool).not.toContain(tool);
      expect(Object.keys(pkg.devDependencies), tool).toContain(tool);
    }
  });

  test("package.json, tauri.conf.json and Cargo.toml give the same version", () => {
    const cargo = cargoToml.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
    expect(tauri.version).toBe(pkg.version);
    expect(cargo).toBe(pkg.version);
  });
});
