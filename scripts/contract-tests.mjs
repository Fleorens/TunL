// Writes, or checks, the contract test files of a task sheet (`tasks/Txx-*.md`).
//
//   node scripts/contract-tests.mjs T10          creates every test file given by the sheet
//   node scripts/contract-tests.mjs T10 --check  compares the files on disk with the sheet
//
// The check ignores formatting: both sides go through Biome (TS, JS, JSON) or rustfmt (Rust) first;
// any other file (shell, config) is compared as written, trailing spaces aside.
// A test file is the first code block after a `### \`path\`` heading of the "## Tests du contrat"
// section, or after a "## Tests du contrat — `path`" heading.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const USAGE = "usage: node scripts/contract-tests.mjs <Txx> [--check]";
const TEST_SECTION = "## Tests du contrat";

function findSheet(id) {
  const name = readdirSync("tasks").find(
    (file) => file.startsWith(`${id}-`) && file.endsWith(".md"),
  );
  if (!name) throw new Error(`no sheet tasks/${id}-*.md`);
  return `tasks/${name}`;
}

function pathIn(heading) {
  return heading.match(/`([^`]+)`/)?.[1] ?? null;
}

function extractTestFiles(markdown) {
  const files = [];
  let inSection = false;
  let path = null;
  let fence = null;
  let body = [];
  for (const line of markdown.split("\n")) {
    if (fence) {
      if (line.trim() === fence) {
        files.push({ path, content: `${body.join("\n")}\n` });
        fence = null;
        path = null;
      } else {
        body.push(line);
      }
      continue;
    }
    if (line.startsWith("## ")) {
      inSection = line.startsWith(TEST_SECTION);
      path = inSection ? pathIn(line) : null;
      continue;
    }
    if (!inSection) continue;
    if (line.startsWith("### ")) {
      path = pathIn(line);
      continue;
    }
    const opening = line.match(/^(`{3,})/);
    if (path && opening) {
      fence = opening[1];
      body = [];
    }
  }
  return files;
}

function normalize(path, content) {
  const options = { input: content, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] };
  if (path.endsWith(".rs")) {
    return execFileSync("rustfmt", ["--edition", "2024", "--emit", "stdout"], options);
  }
  if (!/\.(ts|tsx|js|mjs|json|css)$/.test(path)) {
    // Shell scripts, Containerfiles, configs: compared as written, trailing spaces aside.
    return content.replace(/[ \t]+$/gm, "").trimEnd();
  }
  return execFileSync(
    "node_modules/.bin/biome",
    ["check", "--write", `--stdin-file-path=${path}`],
    options,
  );
}

function firstDifference(expected, actual) {
  const want = expected.split("\n");
  const got = actual.split("\n");
  const index = want.findIndex((line, i) => line !== got[i]);
  const at = index === -1 ? want.length : index;
  return `line ${at + 1}: expected ${JSON.stringify(want[at] ?? "")}, found ${JSON.stringify(got[at] ?? "")}`;
}

function check(files) {
  let failures = 0;
  for (const { path, content } of files) {
    if (!existsSync(path)) {
      console.log(`MISSING    ${path}`);
      failures += 1;
      continue;
    }
    const expected = normalize(path, content);
    const actual = normalize(path, readFileSync(path, "utf8"));
    if (expected === actual) {
      console.log(`OK         ${path}`);
    } else {
      console.log(`DIFFERENT  ${path} (${firstDifference(expected, actual)})`);
      failures += 1;
    }
  }
  return failures;
}

function write(files) {
  for (const { path, content } of files) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(`written    ${path}`);
  }
  return 0;
}

function main() {
  const [id, flag] = process.argv.slice(2);
  if (!/^T\d+b?$/.test(id ?? "") || (flag !== undefined && flag !== "--check")) {
    console.error(USAGE);
    return 2;
  }
  const sheet = findSheet(id);
  const files = extractTestFiles(readFileSync(sheet, "utf8"));
  if (files.length === 0) {
    console.error(`no test file found in the "${TEST_SECTION}" section of ${sheet}`);
    return 1;
  }
  return flag === "--check" ? (check(files) === 0 ? 0 : 1) : write(files);
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
