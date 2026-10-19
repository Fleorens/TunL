// T27: the mock's FreeRDP client, as the UI of T28 and T31 will see it in the browser.
import { beforeEach, describe, expect, test } from "vitest";
import { toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";

beforeEach(() => {
  resetMockBackend();
});

async function forceClientPath(clientPath: string | null) {
  const settings = await ipc.settingsGet();
  await ipc.settingsUpdate({ ...settings, rdp: { ...settings.rdp, clientPath } });
}

describe("mock rdp_detect", () => {
  test("a FreeRDP 3 SDL client is installed by default", async () => {
    expect(await ipc.rdpDetect()).toEqual({
      path: "/usr/bin/sdl-freerdp3",
      version: "3.10.3",
      flavor: "sdl",
    });
  });

  test("a forced FreeRDP path is used as is", async () => {
    await forceClientPath("/opt/freerdp/bin/xfreerdp3");
    expect(await ipc.rdpDetect()).toEqual({
      path: "/opt/freerdp/bin/xfreerdp3",
      version: "3.10.3",
      flavor: "x11",
    });
  });

  test("a forced path that is not FreeRDP is a missing client", async () => {
    await forceClientPath("/usr/bin/rdesktop");
    try {
      await ipc.rdpDetect();
    } catch (error) {
      expect(toAppError(error).kind).toBe("rdpClientMissing");
      return;
    }
    throw new Error("expected rdpClientMissing");
  });
});
