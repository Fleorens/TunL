// T42: the RPM spec carries the version too; check-version.mjs reads it, so a release tag that forgets it fails.
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import pkg from "../package.json";
import spec from "../packaging/rpm/tunl.spec?raw";

const checkVersion = (...args: string[]) =>
  spawnSync("node", ["scripts/check-version.mjs", ...args], { encoding: "utf8" });

describe("the RPM spec version", () => {
  test("its Version: field is the app version", () => {
    expect(spec.match(/^Version:\s*(\S+)/m)?.[1]).toBe(pkg.version);
  });

  test("its latest %changelog entry is for the app version", () => {
    const entry = spec.split(/^%changelog$/m)[1]?.match(/^\* .+ - (\S+)-[^-\s]+$/m)?.[1];
    expect(entry).toBe(pkg.version);
  });
});

describe("check-version.mjs", () => {
  test("passes on the current tree and names the spec", () => {
    const run = checkVersion(`v${pkg.version}`);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("tunl.spec");
  });

  test("a tag the spec does not carry fails, naming both places in the spec", () => {
    const run = checkVersion("v0.0.0-test");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("packaging/rpm/tunl.spec (Version)");
    expect(run.stderr).toContain("packaging/rpm/tunl.spec (%changelog)");
  });
});
