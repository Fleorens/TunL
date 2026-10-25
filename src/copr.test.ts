// T41: the RPM spec and the Copr entry point, read as text: what the package installs, and how it is built.
import { describe, expect, test } from "vitest";
import makefile from "../.copr/Makefile?raw";
import pkg from "../package.json";
import spec from "../packaging/rpm/tunl.spec?raw";
import srpm from "../scripts/copr-srpm.sh?raw";

const field = (name: string) => spec.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim();

describe("tunl.spec", () => {
  test("names the package tunl, at the version of package.json, under the GPL", () => {
    expect(field("Name")).toBe("tunl");
    expect(field("Version")).toBe(pkg.version);
    expect(field("Release")).toBe("1%{?dist}");
    expect(field("License")).toBe("GPL-3.0-or-later");
    expect(field("URL")).toBe("https://github.com/Fleorens/TunL");
  });

  test("builds from the code and the vendored dependencies, offline", () => {
    expect(field("Source0")).toBe("tunl-%{version}.tar.gz");
    expect(field("Source1")).toBe("tunl-%{version}-vendor.tar.xz");
    expect(spec).toContain("npm ci --offline --ignore-scripts");
    expect(spec).toContain("tauri build --no-bundle -- --offline");
  });

  test("skips the debuginfo package (the release binary is stripped)", () => {
    expect(spec).toMatch(/^%global debug_package %\{nil\}$/m);
  });

  test("installs the files of the GitHub rpm (T37)", () => {
    for (const path of [
      "%{_bindir}/tunl",
      "%{_datadir}/applications/tunl.desktop",
      "%{_datadir}/metainfo/io.github.fleorens.TunL.metainfo.xml",
      "%{_datadir}/icons/hicolor/",
    ]) {
      expect(spec, path).toContain(path);
    }
    expect(spec).toMatch(/^%license LICENSE$/m);
  });

  test("recommends FreeRDP for RDP, without requiring it", () => {
    expect(spec).toMatch(/^Recommends:\s*freerdp$/m);
    expect(spec).not.toMatch(/^Requires:\s*freerdp/m);
  });

  test("validates the desktop entry and the metainfo", () => {
    expect(spec).toMatch(/^%check$/m);
    expect(spec).toContain("desktop-file-validate");
    expect(spec).toContain("appstream-util validate-relax --nonet");
  });
});

describe("Copr entry point", () => {
  test(".copr/Makefile has an srpm target that runs the script with the outdir", () => {
    expect(makefile).toMatch(/^srpm:/m);
    expect(makefile).toContain("copr-srpm.sh");
    expect(makefile).toContain("$(outdir)");
  });

  test("the script vendors the crates and the npm cache, then builds the source rpm", () => {
    expect(srpm).toContain("set -euo pipefail");
    expect(srpm).toContain("git archive");
    expect(srpm).toContain("cargo vendor");
    expect(srpm).toContain("npm ci --ignore-scripts");
    expect(srpm).toContain("rpmbuild -bs");
  });
});
