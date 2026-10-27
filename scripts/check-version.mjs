// The version of TunL is written in six places; a release tag must match all of them (T37).
//
//   node scripts/check-version.mjs            checks that the six agree
//   node scripts/check-version.mjs v0.2.0     also checks the tag (with or without its "v")

import { readFileSync } from "node:fs";

const spec = readFileSync("packaging/rpm/tunl.spec", "utf8");

const versions = {
  "package.json": JSON.parse(readFileSync("package.json", "utf8")).version,
  "src-tauri/tauri.conf.json": JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"))
    .version,
  "src-tauri/Cargo.toml": readFileSync("src-tauri/Cargo.toml", "utf8").match(
    /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
  )?.[1],
  "metainfo (latest release)": readFileSync(
    "packaging/linux/io.github.fleorens.TunL.metainfo.xml",
    "utf8",
  ).match(/<release\s+version="([^"]+)"/)?.[1],
  "packaging/rpm/tunl.spec (Version)": spec.match(/^Version:\s*(\S+)/m)?.[1],
  "packaging/rpm/tunl.spec (%changelog)": spec
    .split(/^%changelog$/m)[1]
    ?.match(/^\* .+ - (\S+)-[^-\s]+$/m)?.[1],
};

const tag = process.argv[2]?.replace(/^v/, "");
const expected = tag ?? versions["package.json"];
const wrong = Object.entries(versions).filter(([, version]) => version !== expected);

if (wrong.length > 0) {
  for (const [file, version] of wrong) {
    console.error(`${file}: ${version ?? "no version found"}, expected ${expected}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `version ${expected}: package.json, tauri.conf.json, Cargo.toml, the metainfo and packaging/rpm/tunl.spec agree`,
  );
}
