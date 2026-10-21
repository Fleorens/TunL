// Project rules that neither the compilers nor the linters check. Each one comes from a defect found in review,
// or from a rule of docs/06-securite.md. Part of `npm run rules`, so of `npm run verify`.
//
//   node scripts/project-rules.mjs
//
// A line that must break a rule carries, on the same line or the line above:
//   // project-rules: allow <rule-id> — <why>
// The orchestrator reviews every such exception.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const MAX_LINES = 400;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const isTest = (path) => /(\.test\.tsx?|_tests\.rs|\/tests\.rs|\.spec\.ts)$/.test(path);
const ts = walk("src").filter((p) => /\.tsx?$/.test(p) && !p.startsWith("src/bindings/"));
const own = ts.filter((p) => !p.startsWith("src/components/ui/"));
const rust = walk("src-tauri/src").filter((p) => p.endsWith(".rs"));
const e2e = walk("e2e").filter((p) => p.endsWith(".ts"));

/** Source lines, cut at the first inline `#[cfg(test)]` module for Rust. */
function lines(path) {
  const all = readFileSync(path, "utf8").split("\n");
  const cut =
    path.endsWith(".rs") && !isTest(path) ? all.findIndex((l) => l.includes("#[cfg(test)]")) : -1;
  return cut === -1 ? all : all.slice(0, cut);
}

const isComment = (line) => /^\s*(\/\/|\/?\*)/.test(line);

/** Line rules: files, a pattern, a message. Comment lines are skipped. */
const LINE_RULES = [
  {
    id: "no-unsafe-cast",
    files: own.filter((p) => !isTest(p)),
    pattern: /\bas (never|any)\b|: any\b|@ts-(ignore|expect-error)/,
    message: "no `as never`, `as any`, `: any` or @ts-ignore: type it properly",
  },
  {
    id: "raw-form-element",
    files: own,
    pattern: /^\s*<(input|textarea|select)\b/,
    message: "use the shadcn component (Input, Textarea, Select) or the editor's StringField",
  },
  {
    id: "no-console",
    files: own.filter((p) => !isTest(p)),
    pattern: /\bconsole\.(log|debug|info)\(/,
    message: "no console output in app code",
  },
  {
    id: "no-focused-or-skipped-test",
    files: [...ts.filter(isTest), ...e2e],
    pattern: /\b(test|it|describe)\.(only|skip|fixme)\(|\bxit\(/,
    message: "a test must run: no .only, .skip or .fixme",
  },
  {
    id: "no-ignored-rust-test",
    files: rust,
    pattern: /#\[ignore\]/,
    message: "a test must run: no #[ignore]",
  },
  {
    id: "no-panic-in-app-code",
    files: rust.filter((p) => !isTest(p)),
    pattern: /\.unwrap\(\)|\.expect\(|\b(panic|unreachable|todo|unimplemented|println|dbg)!/,
    message:
      "return an AppError instead (unwrap/expect/panic!/unreachable!/todo!/println! only in tests)",
  },
  {
    id: "tauri-request-struct",
    files: rust.filter((p) => p.includes("/commands/")),
    pattern: /struct \w+Request\b/,
    message: "one parameter per JSON key sent by ipc.ts, never a request struct (see AGENTS.md)",
  },
  {
    id: "no-html-injection",
    files: own,
    pattern: /dangerouslySetInnerHTML|\beval\(|new Function\(/,
    message: "forbidden by S13",
  },
  {
    id: "no-secret-read-command",
    files: [...own, ...rust],
    pattern: /secret_get|secretGet/,
    message: "the frontend never reads a secret (S2)",
  },
  {
    id: "no-process-spawn",
    files: rust.filter((p) => !p.includes("/rdp/")),
    pattern: /Command::new|std::process::Command/,
    message: "only src-tauri/src/rdp/ may start a process (S4, S12)",
  },
  {
    id: "local-storage",
    files: own.filter((p) => !isTest(p) && p !== "src/lib/theme.ts"),
    pattern: /\blocalStorage\b/,
    message: "localStorage only in src/lib/theme.ts (S1: never a secret there)",
  },
  {
    id: "icon-button",
    files: own.filter(
      (p) => !isTest(p) && !p.startsWith("src/dev/") && p !== "src/components/IconButton.tsx",
    ),
    pattern: /size="icon/,
    message:
      "an icon-only button is an IconButton: its label is both its aria-label and its tooltip (docs/03 §10)",
  },
  {
    id: "e2e-console-guard",
    files: e2e.filter((p) => p.endsWith(".spec.ts")),
    pattern: /from "@playwright\/test"/,
    message: 'import test and expect from "./support/test.ts" (it fails a test on console errors)',
  },
];

// Every exception names an existing rule and sits on (or just above) a line that breaks it: a stale or
// misspelt marker hides nothing and misleads the review.
const RULE_IDS = new Set([
  ...LINE_RULES.map((rule) => rule.id),
  "file-size",
  "command-registered",
  "near-duplicate",
]);
function checkMarkers(path, fileLines) {
  fileLines.forEach((line, index) => {
    const id = line.match(/project-rules: allow ([\w-]+)/)?.[1];
    if (!id) return;
    if (!RULE_IDS.has(id)) {
      report(path, index + 1, "allow-marker", `unknown rule "${id}": remove the marker`);
      return;
    }
    const rule = LINE_RULES.find((r) => r.id === id);
    const breaks = (l) => l !== undefined && !isComment(l) && rule.pattern.test(l);
    if (rule && !breaks(line) && !breaks(fileLines[index + 1])) {
      report(path, index + 1, "allow-marker", `nothing below breaks "${id}": remove the marker`);
    }
  });
}

function allowed(fileLines, index, id) {
  const marker = `project-rules: allow ${id}`;
  return fileLines[index].includes(marker) || (index > 0 && fileLines[index - 1].includes(marker));
}

const problems = [];
const report = (path, line, id, message) => problems.push(`${path}:${line}  [${id}] ${message}`);

for (const rule of LINE_RULES) {
  for (const path of rule.files) {
    const fileLines = lines(path);
    fileLines.forEach((line, index) => {
      if (isComment(line) || !rule.pattern.test(line) || allowed(fileLines, index, rule.id)) return;
      report(path, index + 1, rule.id, rule.message);
    });
  }
}

for (const path of [...own, ...rust, ...e2e])
  checkMarkers(path, readFileSync(path, "utf8").split("\n"));

// File size: split a file before it becomes a wall (AGENTS.md: 400 lines).
for (const path of [...own, ...rust].filter((p) => !isTest(p))) {
  const count = readFileSync(path, "utf8").split("\n").length;
  const fileLines = readFileSync(path, "utf8").split("\n");
  if (count > MAX_LINES && !allowed(fileLines, 0, "file-size")) {
    report(path, 1, "file-size", `${count} lines (max ${MAX_LINES}): split it by responsibility`);
  }
}

// Every #[tauri::command] is registered in invoke_handler().
const handler =
  readFileSync("src-tauri/src/lib.rs", "utf8").match(/generate_handler!\[([\s\S]*?)\]/)?.[1] ?? "";
const registered = new Set(handler.split(",").map((p) => p.trim().split("::").at(-1)));
for (const path of rust.filter((p) => p.includes("/commands/") && !isTest(p))) {
  const text = readFileSync(path, "utf8");
  for (const match of text.matchAll(/#\[tauri::command\]\s*pub async fn (\w+)/g)) {
    if (!registered.has(match[1]))
      report(path, 1, "command-registered", `${match[1]} is not in invoke_handler()`);
  }
}

// Near-duplicate modules: the same logic written twice (lot 2 had two `to-input.ts`).
function signature(path) {
  const meaningful = readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && !isComment(l) && !l.startsWith("import "));
  return new Set(meaningful);
}
const candidates = own.filter((p) => !isTest(p)).map((path) => ({ path, lines: signature(path) }));
for (const [i, a] of candidates.entries()) {
  for (const b of candidates.slice(i + 1)) {
    if (a.lines.size < 8 || b.lines.size < 8) continue;
    const shared = [...a.lines].filter((l) => b.lines.has(l)).length;
    if (shared / Math.min(a.lines.size, b.lines.size) >= 0.8) {
      report(
        a.path,
        1,
        "near-duplicate",
        `mostly the same code as ${b.path} (${basename(b.path)}): keep one`,
      );
    }
  }
}

if (problems.length > 0) {
  console.log(problems.join("\n"));
  console.log(
    `\n${problems.length} project rule problem(s). Fix the code. If a rule is really wrong for one line, add ` +
      "`// project-rules: allow <rule-id> — <why>` on it or just above: the orchestrator reviews each exception.",
  );
  process.exitCode = 1;
} else {
  console.log(`project rules: OK (${own.length + rust.length + e2e.length} files)`);
}
