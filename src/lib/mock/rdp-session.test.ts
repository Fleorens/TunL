// T28: the mock's RDP tabs, which the RDP card of T28b is built against.
import { beforeEach, describe, expect, test } from "vitest";
import type { SessionEvent } from "@/bindings/SessionEvent";
import { toInput } from "@/features/connections/to-input";
import { toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";
import { MOCK_IDS } from "@/lib/mock/data";

beforeEach(() => {
  resetMockBackend();
});

/** Open an RDP tab and collect its events until it is connected and has logged twice. */
async function open(connectionId: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  await new Promise<void>((resolve) => {
    void ipc.rdpOpen(crypto.randomUUID(), connectionId, (event) => {
      events.push(event);
      const connected = events.findIndex((e) => e.type === "connected");
      if (connected >= 0 && events.slice(connected).filter((e) => e.type === "log").length === 2) {
        resolve();
      }
    });
  });
  return events;
}

function steps(events: SessionEvent[]) {
  return events.flatMap((e) =>
    e.type === "step" && e.state === "done" ? [`${e.step}:${e.label}`] : [],
  );
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return toAppError(error);
  }
  throw new Error("expected a rejection");
}

describe("mock rdp_open", () => {
  test("a direct connection launches the client, then logs", async () => {
    const events = await open(MOCK_IDS.ad01);
    expect(steps(events)).toEqual(["launch:sdl-freerdp3"]);
    expect(events.filter((e) => e.type === "log").at(0)).toEqual({
      type: "log",
      line: "[INFO][com.freerdp.core] connected to 10.0.0.5",
    });
  });

  test("a connection that wakes its host first", async () => {
    const events = await open(MOCK_IDS.winDesktop);
    expect(steps(events)).toEqual(["wake:win-desktop", "launch:sdl-freerdp3"]);
  });

  test("behind a bastion: the bastion's steps, the tunnel, its address in the log", async () => {
    const { connections } = await ipc.storeLoad();
    const ad01 = connections.find((c) => c.id === MOCK_IDS.ad01);
    if (!ad01) throw new Error("ad-01 is in the demo data");
    await ipc.connectionUpdate(ad01.id, { ...toInput(ad01), jumpHostId: MOCK_IDS.bastion01 });
    const events = await open(MOCK_IDS.ad01);
    expect(steps(events)).toEqual([
      "target:bastion.example.net:2222",
      "hostKey:bastion.example.net",
      "auth:ops",
      "open:tunnel",
      "launch:sdl-freerdp3",
    ]);
    expect(events).toContainEqual({ type: "log", line: "tunnel 127.0.0.1:40123 → 10.0.0.5:3389" });
  });

  test("refusals come back at once", async () => {
    expect((await rejection(ipc.rdpOpen(crypto.randomUUID(), MOCK_IDS.nas, () => {}))).kind).toBe(
      "validation",
    );
    const settings = await ipc.settingsGet();
    await ipc.settingsUpdate({
      ...settings,
      rdp: { ...settings.rdp, clientPath: "/usr/bin/rdesktop" },
    });
    expect((await rejection(ipc.rdpOpen(crypto.randomUUID(), MOCK_IDS.ad01, () => {}))).kind).toBe(
      "rdpClientMissing",
    );
  });
});
