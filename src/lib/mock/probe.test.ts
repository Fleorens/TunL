// T30: the mock's probes, as the dots of the browser UI show them.
import { beforeEach, describe, expect, test } from "vitest";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";
import { MOCK_IDS } from "@/lib/mock/data";

beforeEach(() => {
  resetMockBackend();
});

describe("mock probe_check", () => {
  test("a direct host answers, a down one does not, one behind a bastion is skipped", async () => {
    const results = await ipc.probeCheck([MOCK_IDS.nas, MOCK_IDS.web01]);
    expect(results.map((r) => [r.connectionId, r.status])).toEqual([
      [MOCK_IDS.nas, "online"],
      [MOCK_IDS.web01, "skipped"],
    ]);
    expect(results[0].latencyMs).toBeGreaterThan(0);
    expect(results[1].latencyMs).toBeNull();
  });

  test("an unknown id is left out", async () => {
    expect(await ipc.probeCheck(["00000000-0000-4000-8000-0000000000ff"])).toEqual([]);
  });

  test("with the probes off, everything is skipped", async () => {
    const settings = await ipc.settingsGet();
    await ipc.settingsUpdate({
      ...settings,
      reachability: { ...settings.reachability, enabled: false },
    });
    const [nas] = await ipc.probeCheck([MOCK_IDS.nas]);
    expect(nas.status).toBe("skipped");
  });
});
