import { beforeEach, expect, test } from "vitest";
import { toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { failNextCall, resetMockBackend } from "@/lib/ipc-mock";
import { MOCK_IDS } from "@/lib/mock/data";

beforeEach(() => {
  resetMockBackend();
});

test("the preview lists the canned candidates", async () => {
  const preview = await ipc.importSshConfigPreview(null);
  expect(preview.path).toBe("~/.ssh/config");
  expect(preview.candidates.map((c) => c.alias)).toEqual([
    "staging",
    "jump-box",
    "web-01",
    "legacy",
    "broken",
  ]);
  expect(preview.candidates.find((c) => c.alias === "web-01")?.duplicateOf).toBe(MOCK_IDS.web01);
  expect(preview.candidates.find((c) => c.alias === "staging")?.jump).toEqual({
    type: "candidate",
    alias: "jump-box",
  });
});

test("apply creates the selected connections and links the jump host", async () => {
  const snapshot = await ipc.importSshConfigApply(null, ["staging", "jump-box"], MOCK_IDS.homelab);
  const staging = snapshot.connections.find((c) => c.name === "staging");
  const jump = snapshot.connections.find((c) => c.name === "jump-box");
  expect(staging?.jumpHostId).toBe(jump?.id);
  expect(staging?.groupId).toBe(MOCK_IDS.homelab);
  expect(jump?.port).toBe(2222);
  expect(staging?.settings).toMatchObject({
    protocol: "ssh",
    auth: { method: "key", path: "~/.ssh/id_ed25519" },
  });
  expect(jump?.settings).toMatchObject({ protocol: "ssh", auth: { method: "agent" } });
});

test("a jump to an unselected candidate is dropped", async () => {
  const snapshot = await ipc.importSshConfigApply(null, ["staging"], null);
  expect(snapshot.connections.find((c) => c.name === "staging")?.jumpHostId).toBeNull();
});

test("a candidate with an error is never created", async () => {
  const before = (await ipc.storeLoad()).connections.length;
  const snapshot = await ipc.importSshConfigApply(null, ["broken"], null);
  expect(snapshot.connections.length).toBe(before);
});

test("a missing file can be simulated", async () => {
  failNextCall("import_ssh_config_preview", {
    kind: "notFound",
    message: "ssh config ~/.ssh/config not found",
    detail: null,
  });
  await expect(ipc.importSshConfigPreview(null).catch(toAppError)).resolves.toMatchObject({
    kind: "notFound",
  });
});
