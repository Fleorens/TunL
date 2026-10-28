// T50: a tab's output acks are batched, then sent to its current attempt while it is live.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { getSessionPort } from "./session-ports";
import { useSessions } from "./store";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(ipc, "sshOpen").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  useSessions.setState({ sessions: [], activeId: null, closing: null });
});

/** A new quick tab (still connecting, so live), its port, and a spy on the acks it sends. */
function openTab() {
  const ack = vi.spyOn(ipc, "sshAck").mockResolvedValue(undefined);
  const id = useSessions
    .getState()
    .open({ type: "quick", host: "10.0.0.1", port: 22, username: null }, "quick");
  const port = getSessionPort(id)?.port;
  if (!port) throw new Error("no port");
  return { id, port, ack };
}

function setRun(id: string, change: { runId?: string; status?: "closed" }): void {
  useSessions.setState((state) => ({
    sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...change } : s)),
  }));
}

describe("ack batching", () => {
  test("small acks go out together, 100 ms after the last one", () => {
    const { id, port, ack } = openTab();
    port.ack(1000);
    vi.advanceTimersByTime(60);
    port.ack(500);
    vi.advanceTimersByTime(99);
    expect(ack).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ack).toHaveBeenCalledExactlyOnceWith(id, 1500);
  });

  test("256 KiB go out at once", () => {
    const { id, port, ack } = openTab();
    port.ack(200 * 1024);
    port.ack(56 * 1024);
    expect(ack).toHaveBeenCalledExactlyOnceWith(id, 256 * 1024);
    vi.advanceTimersByTime(200);
    expect(ack).toHaveBeenCalledOnce();
  });

  test("a new attempt starts from zero, and an ended session gets nothing", () => {
    const { id, port, ack } = openTab();
    port.ack(1000);
    setRun(id, { runId: "run-2" });
    vi.advanceTimersByTime(100);
    expect(ack).not.toHaveBeenCalled();
    port.ack(300);
    vi.advanceTimersByTime(100);
    expect(ack).toHaveBeenCalledExactlyOnceWith("run-2", 300);

    setRun(id, { status: "closed" });
    port.ack(700);
    vi.advanceTimersByTime(100);
    expect(ack).toHaveBeenCalledOnce();
  });
});
