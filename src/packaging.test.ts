// T36: the desktop integration files agree with each other and with the app (id, version, binary, screenshots).
// The files are read through Vite (`?raw`, `import.meta.glob`), like `lib/ipc-contract.test.ts`: no Node API here.
import { describe, expect, test } from "vitest";
import appIcon from "../branding/app-icon.svg?raw";
import pkg from "../package.json";
import metainfoXml from "../packaging/linux/io.github.fleorens.TunL.metainfo.xml?raw";
import desktopTemplate from "../packaging/linux/tunl.desktop.hbs?raw";
import tauri from "../src-tauri/tauri.conf.json";

const METAINFO = "packaging/linux/io.github.fleorens.TunL.metainfo.xml";
const DESKTOP = "packaging/linux/tunl.desktop.hbs";

/** Files of the repository, by their path from its root. */
const files = new Set(
  Object.keys(
    import.meta.glob(["../src-tauri/icons/*.png", "../docs/screenshots/*.png"], { eager: false }),
  ).map((path) => path.replace(/^\.\.\//, "")),
);

function existsSync(path: string): boolean {
  return files.has(path);
}

function metainfo(): Document {
  return new DOMParser().parseFromString(metainfoXml, "application/xml");
}

function text(doc: Document, selector: string): string | undefined {
  return doc.querySelector(selector)?.textContent?.trim();
}

describe("tauri.conf.json", () => {
  test("the package is `tunl` (D14), the window says TunL", () => {
    expect(tauri.productName).toBe("tunl");
    expect(tauri.identifier).toBe("io.github.fleorens.TunL");
    expect(tauri.app.windows[0]?.title).toBe("TunL");
    expect(tauri.version).toBe(pkg.version);
  });

  test("deb and rpm use the desktop template and install the metainfo; every icon exists", () => {
    const target = "/usr/share/metainfo/io.github.fleorens.TunL.metainfo.xml";
    for (const format of [tauri.bundle.linux.deb, tauri.bundle.linux.rpm]) {
      expect(format.desktopTemplate).toBe(`../${DESKTOP}`);
      expect(format.files).toEqual({ [target]: `../${METAINFO}` });
    }
    expect(tauri.bundle.linux.appimage.files).toEqual({ [target]: `../${METAINFO}` });
    for (const icon of tauri.bundle.icon) {
      expect(existsSync(`src-tauri/${icon}`), icon).toBe(true);
    }
  });
});

describe("the AppStream metainfo", () => {
  test("names the app, its licence, its desktop file and its binary", () => {
    const doc = metainfo();
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(text(doc, "component > id")).toBe(tauri.identifier);
    expect(text(doc, "project_license")).toBe("GPL-3.0-or-later");
    expect(text(doc, "metadata_license")).toBe("CC0-1.0");
    expect(text(doc, "launchable[type='desktop-id']")).toBe("tunl.desktop");
    expect(text(doc, "provides > binary")).toBe("tunl");
    expect(text(doc, "url[type='homepage']")).toBe("https://github.com/Fleorens/TunL");
  });

  test("its latest release is the app's version", () => {
    const release = metainfo().querySelector("releases > release");
    expect(release?.getAttribute("version")).toBe(pkg.version);
    expect(release?.getAttribute("date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("every screenshot is a file of docs/screenshots, published from the main branch", () => {
    const images = [...metainfo().querySelectorAll("screenshot > image")].map(
      (image) => image.textContent?.trim() ?? "",
    );
    expect(images.length).toBeGreaterThanOrEqual(3);
    const prefix = "https://raw.githubusercontent.com/Fleorens/TunL/main/";
    for (const url of images) {
      expect(url.startsWith(prefix), url).toBe(true);
      expect(existsSync(url.slice(prefix.length)), url).toBe(true);
    }
  });
});

describe("the desktop entry template", () => {
  test("runs the binary with its icon, in the network menus, for the X11 window class", () => {
    const lines = desktopTemplate.split("\n");
    expect(lines[0]).toBe("[Desktop Entry]");
    for (const line of [
      "Type=Application",
      "Name=TunL",
      "Exec={{exec}}",
      "Icon={{icon}}",
      "Terminal=false",
      "Categories=Network;RemoteAccess;",
      "StartupWMClass=tunl",
    ]) {
      expect(lines).toContain(line);
    }
    expect(lines.some((line) => line.startsWith("Comment[fr]="))).toBe(true);
  });
});

test("the app icon is the brand's tile, as an SVG", () => {
  const svg = appIcon;
  expect(svg).toContain('viewBox="0 0 128 128"');
  expect(svg).toContain("<title>TunL</title>");
});
