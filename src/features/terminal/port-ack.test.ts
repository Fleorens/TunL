// T50: every byte pushed into a port is acked once: by the terminal once parsed, or by the port when it drops it.
import { describe, expect, test, vi } from "vitest";
import { createTerminalPort } from "./port";

function sender() {
  return {
    write: vi.fn<(data: string) => void>(),
    resize: vi.fn<(cols: number, rows: number) => void>(),
    ack: vi.fn<(bytes: number) => void>(),
  };
}

describe("acks", () => {
  test("output dropped while nobody listens is acked at once", () => {
    const out = sender();
    const { push } = createTerminalPort(out, 10);
    push(new Uint8Array(6));
    expect(out.ack).not.toHaveBeenCalled();
    push(new Uint8Array(6));
    expect(out.ack).toHaveBeenCalledExactlyOnceWith(6);
  });

  test("the terminal acks what it parsed through its port", () => {
    const out = sender();
    const { port } = createTerminalPort(out);
    port.ack(1234);
    expect(out.ack).toHaveBeenCalledExactlyOnceWith(1234);
  });

  test("a sender without ack still works", () => {
    const { port, push } = createTerminalPort({ write: vi.fn(), resize: vi.fn() }, 4);
    push(new Uint8Array(6));
    expect(() => port.ack(6)).not.toThrow();
  });
});
