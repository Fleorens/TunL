import { describe, expect, test, vi } from "vitest";
import { createTerminalPort } from "./port";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (chunks: Uint8Array[]) => chunks.map((c) => new TextDecoder().decode(c)).join("");

function sender() {
  return {
    write: vi.fn<(data: string) => void>(),
    resize: vi.fn<(cols: number, rows: number) => void>(),
  };
}

describe("createTerminalPort", () => {
  test("output that arrives before the terminal is replayed in order, then goes live", () => {
    const { port, push } = createTerminalPort(sender());
    push(bytes("Welcome\r\n"));
    push(bytes("$ "));
    const seen: Uint8Array[] = [];
    port.subscribe((chunk) => seen.push(chunk));
    expect(text(seen)).toBe("Welcome\r\n$ ");
    push(bytes("ls"));
    expect(text(seen)).toBe("Welcome\r\n$ ls");
  });

  test("while nobody listens, the oldest output is dropped beyond the limit", () => {
    const { port, push } = createTerminalPort(sender(), 10);
    push(bytes("aaaa"));
    push(bytes("bbbb"));
    push(bytes("cccc"));
    const seen: Uint8Array[] = [];
    port.subscribe((chunk) => seen.push(chunk));
    expect(text(seen)).toBe("bbbbcccc");
  });

  test("after unsubscribing, output is kept for the next listener", () => {
    const { port, push } = createTerminalPort(sender());
    const first: Uint8Array[] = [];
    const unsubscribe = port.subscribe((chunk) => first.push(chunk));
    push(bytes("one"));
    unsubscribe();
    push(bytes("two"));
    const second: Uint8Array[] = [];
    port.subscribe((chunk) => second.push(chunk));
    expect(text(first)).toBe("one");
    expect(text(second)).toBe("two");
  });

  test("a new listener replaces the previous one", () => {
    const { port, push } = createTerminalPort(sender());
    const first: Uint8Array[] = [];
    const second: Uint8Array[] = [];
    port.subscribe((chunk) => first.push(chunk));
    port.subscribe((chunk) => second.push(chunk));
    push(bytes("x"));
    expect(first).toHaveLength(0);
    expect(text(second)).toBe("x");
  });

  test("input goes straight to the sender; a size is sent only when it changes", () => {
    const s = sender();
    const { port } = createTerminalPort(s);
    port.write("ls\r");
    port.resize(80, 24);
    port.resize(80, 24);
    port.resize(120, 40);
    expect(s.write).toHaveBeenCalledWith("ls\r");
    expect(s.resize.mock.calls).toEqual([
      [80, 24],
      [120, 40],
    ]);
  });
});
