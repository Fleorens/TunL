// The browser mock of the SSH sessions (T19): the steps, a tiny shell, the refusals. The UI of T20–T21 is
// developed and tested against it, so its behaviour is a contract too.
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SessionEvent } from "@/bindings/SessionEvent";
import type { SessionTarget } from "@/bindings/SessionTarget";
import { toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";
import { MOCK_IDS } from "@/lib/mock/data";

const SIZE = { cols: 80, rows: 24 };

function recorder() {
  const events: SessionEvent[] = [];
  const decoder = new TextDecoder();
  let output = "";
  return {
    events,
    text: () => output,
    callbacks: {
      onEvent: (event: SessionEvent) => {
        events.push(event);
      },
      onOutput: (bytes: Uint8Array) => {
        output += decoder.decode(bytes);
      },
    },
  };
}

type Recorder = ReturnType<typeof recorder>;

const nas: SessionTarget = { type: "saved", connectionId: MOCK_IDS.nas };

async function openConnected(id: string, target: SessionTarget = nas): Promise<Recorder> {
  const r = recorder();
  await ipc.sshOpen(id, target, SIZE, r.callbacks);
  await vi.waitFor(() => expect(r.events).toContainEqual({ type: "connected" }));
  return r;
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return toAppError(error);
  }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  resetMockBackend();
});

describe("mock SSH sessions", () => {
  test("a direct connection goes through the four steps, then prints a banner and a prompt", async () => {
    const r = await openConnected("s1");
    const steps = r.events.flatMap((e) => (e.type === "step" ? [`${e.step}:${e.state}`] : []));
    expect(steps).toEqual([
      "target:started",
      "target:done",
      "hostKey:started",
      "hostKey:done",
      "auth:started",
      "auth:done",
      "open:started",
      "open:done",
    ]);
    expect(r.events.at(-1)).toEqual({ type: "connected" });
    await vi.waitFor(() => expect(r.text()).toContain("Welcome to nas"));
    expect(r.text()).toContain("admin@192.168.1.10:~$ ");
  });

  test("a connection behind a bastion goes through a Hop step first", async () => {
    const r = await openConnected("s1", { type: "saved", connectionId: MOCK_IDS.web01 });
    expect(r.events.slice(0, 3)).toEqual([
      { type: "step", step: "hop", label: "bastion-01", state: "started" },
      { type: "step", step: "hop", label: "bastion-01", state: "done" },
      { type: "step", step: "target", label: "10.0.0.12:22", state: "started" },
    ]);
    await vi.waitFor(() => expect(r.text()).toContain("deploy@10.0.0.12:~$ "));
  });

  test("typed characters are echoed and a line runs on Enter", async () => {
    const r = await openConnected("s1");
    await ipc.sshWrite("s1", "echo hello\r");
    await vi.waitFor(() => expect(r.text()).toContain("echo hello\r\nhello\r\n"));

    await ipc.sshWrite("s1", "whoami\r");
    await vi.waitFor(() => expect(r.text()).toContain("mock: whoami: command not found\r\n"));
  });

  test("backspace erases the last typed character", async () => {
    const r = await openConnected("s1");
    await ipc.sshWrite("s1", "echo x\u007fy\r");
    await vi.waitFor(() => expect(r.text()).toContain("\b \b"));
    await vi.waitFor(() => expect(r.text()).toContain("y\r\n"));
    expect(r.text()).not.toContain("xy\r\n");
  });

  test("stty size tells the last size the terminal sent", async () => {
    const r = await openConnected("s1");
    await ipc.sshResize("s1", { cols: 132, rows: 40 });
    await ipc.sshWrite("s1", "stty size\r");
    await vi.waitFor(() => expect(r.text()).toContain("40 132\r\n"));
  });

  test("exit closes the session with its status, and the session is gone", async () => {
    const r = await openConnected("s1");
    await ipc.sshWrite("s1", "exit 3\r");
    await vi.waitFor(() =>
      expect(r.events.at(-1)).toEqual({ type: "closed", reason: "remoteClosed", exitStatus: 3 }),
    );
    expect((await rejection(ipc.sshWrite("s1", "ls\r"))).kind).toBe("notFound");
  });

  test("a quick target connects with the typed user, or the local one", async () => {
    const quick = await openConnected("q1", {
      type: "quick",
      host: "10.5.5.5",
      port: 2222,
      username: "ops",
    });
    await vi.waitFor(() => expect(quick.text()).toContain("ops@10.5.5.5:~$ "));
    await vi.waitFor(() => expect(quick.text()).toContain("Welcome to ops@10.5.5.5"));

    const local = await openConnected("q2", {
      type: "quick",
      host: "10.5.5.6",
      port: 22,
      username: null,
    });
    await vi.waitFor(() => expect(local.text()).toContain("user@10.5.5.6:~$ "));
  });

  test("an unreachable quick target fails at the Target step", async () => {
    const r = recorder();
    await ipc.sshOpen(
      "s1",
      { type: "quick", host: "unreachable.test", port: 22, username: null },
      SIZE,
      r.callbacks,
    );
    await vi.waitFor(() => expect(r.events.at(-1)?.type).toBe("error"));
    expect(r.events.slice(0, 2)).toEqual([
      { type: "step", step: "target", label: "unreachable.test:22", state: "started" },
      { type: "step", step: "target", label: "unreachable.test:22", state: "failed" },
    ]);
    const last = r.events.at(-1);
    expect(last?.type === "error" && last.error.kind).toBe("network");
    expect(r.events).not.toContainEqual({ type: "connected" });
  });

  test("unknown, RDP and invalid targets are refused at once", async () => {
    const unknown = {
      type: "saved",
      connectionId: "00000000-0000-4000-8000-000000000000",
    } as const;
    expect((await rejection(ipc.sshOpen("a", unknown, SIZE, recorder().callbacks))).kind).toBe(
      "notFound",
    );
    const rdp = { type: "saved", connectionId: MOCK_IDS.ad01 } as const;
    expect((await rejection(ipc.sshOpen("b", rdp, SIZE, recorder().callbacks))).kind).toBe(
      "validation",
    );
    const bad = { type: "quick", host: "bad host!", port: 22, username: null } as const;
    expect((await rejection(ipc.sshOpen("c", bad, SIZE, recorder().callbacks))).kind).toBe(
      "validation",
    );
  });

  test("a session id is used once", async () => {
    await openConnected("s1");
    const error = await rejection(ipc.sshOpen("s1", nas, SIZE, recorder().callbacks));
    expect(error.kind).toBe("validation");
  });

  test("closing stops the session; closing twice is harmless", async () => {
    const r = await openConnected("s1");
    await ipc.sessionClose("s1");
    expect((await rejection(ipc.sshWrite("s1", "ls\r"))).kind).toBe("notFound");
    await ipc.sessionClose("s1");
    // The UI closed it: no Closed event is sent back.
    expect(r.events.some((e) => e.type === "closed")).toBe(false);
  });

  test("resetting the mock drops every session", async () => {
    await openConnected("s1");
    resetMockBackend();
    expect((await rejection(ipc.sshWrite("s1", "ls\r"))).kind).toBe("notFound");
  });
});
