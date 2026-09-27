// Every command called by `ipc.ts` must exist on both sides: registered in Rust (`invoke_handler` in
// `src-tauri/src/lib.rs`), driven through Tauri's real IPC by `src-tauri/src/commands/ipc*_tests.rs`, and answered
// by the browser mock. The mock alone would hide a command missing from Rust (lot 2 review).
import { describe, expect, test } from "vitest";
import libRs from "../../src-tauri/src/lib.rs?raw";
import ipcSource from "./ipc.ts?raw";
import { MOCK_COMMANDS } from "./ipc-mock";

// `ipc_tests.rs`, plus one `ipc_<domain>_tests.rs` per sheet that adds commands.
const ipcTestFiles: Record<string, string> = import.meta.glob(
  "../../src-tauri/src/commands/ipc*_tests.rs",
  { query: "?raw", import: "default", eager: true },
);
const ipcTests = Object.values(ipcTestFiles).join("\n");

const ipcCommands = [...ipcSource.matchAll(/call<[^>]*>\("(\w+)"/g)].map((m) => m[1]);
const handlerBlock = libRs.match(/generate_handler!\[([\s\S]*?)\]/)?.[1] ?? "";
const rustCommands = handlerBlock
  .split(",")
  .map((path: string) => path.trim().split("::").at(-1) ?? "")
  .filter((name: string) => name !== "");

describe("IPC contract", () => {
  test("ipc.ts calls at least the commands of lot 2", () => {
    expect(ipcCommands.length).toBeGreaterThanOrEqual(15);
  });

  test.each(ipcCommands)("%s is registered in Rust", (command) => {
    expect(rustCommands).toContain(command);
  });

  test.each(ipcCommands)("%s goes through the real IPC in an ipc*_tests.rs", (command) => {
    expect(ipcTests).toContain(`"${command}"`);
  });

  test.each(ipcCommands)("%s is answered by the mock", (command) => {
    expect(MOCK_COMMANDS).toContain(command);
  });

  test("Rust registers no command that ipc.ts does not expose", () => {
    expect([...rustCommands].sort()).toEqual([...new Set(ipcCommands)].sort());
  });
});
