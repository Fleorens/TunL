// T29: the mock's Wake-on-LAN, and the Wake step of a session.
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

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return toAppError(error);
  }
  throw new Error("expected a rejection");
}

/** Open a session on `connectionId` and collect its events until it is connected. */
async function stepsOf(connectionId: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  await new Promise<void>((resolve) => {
    void ipc.sshOpen(
      crypto.randomUUID(),
      { type: "saved", connectionId },
      { cols: 80, rows: 24 },
      {
        onEvent: (event) => {
          events.push(event);
          if (event.type === "connected") resolve();
        },
        onOutput: () => {},
      },
    );
  });
  return events;
}

describe("mock wol_wake", () => {
  test("a connection with Wake-on-LAN is woken", async () => {
    await expect(ipc.wolWake(MOCK_IDS.winDesktop)).resolves.toBeNull();
  });

  test("a connection without Wake-on-LAN is refused on the wol field", async () => {
    const error = await rejection(ipc.wolWake(MOCK_IDS.nas));
    expect(error.kind).toBe("validation");
    expect(error.message.startsWith("wol")).toBe(true);
  });
});

describe("the Wake step", () => {
  test("comes first for a direct connection that asks for it", async () => {
    const { connections } = await ipc.storeLoad();
    const nas = connections.find((c) => c.id === MOCK_IDS.nas);
    if (!nas) throw new Error("nas is in the demo data");
    await ipc.connectionUpdate(nas.id, {
      ...toInput(nas),
      wol: {
        mac: "AA:BB:CC:DD:EE:FF",
        broadcast: "255.255.255.255",
        port: 9,
        wakeBeforeConnect: true,
        waitTimeoutSecs: 120,
      },
    });
    const steps = (await stepsOf(nas.id)).filter((e) => e.type === "step");
    expect(steps.slice(0, 2)).toEqual([
      { type: "step", step: "wake", label: "nas", state: "started" },
      { type: "step", step: "wake", label: "nas", state: "done" },
    ]);
    expect(steps[2]).toMatchObject({ step: "target" });
  });

  test("is absent without wakeBeforeConnect", async () => {
    const steps = await stepsOf(MOCK_IDS.nas);
    expect(steps.some((e) => e.type === "step" && e.step === "wake")).toBe(false);
  });
});
