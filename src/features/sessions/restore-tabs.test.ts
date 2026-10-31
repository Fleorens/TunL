// T60: which tabs are saved, and which of them can open again.
import { describe, expect, test } from "vitest";
import type { SessionTarget } from "@/bindings/SessionTarget";
import { MOCK_CONNECTIONS, MOCK_IDS } from "@/lib/mock/data";
import { restorable, savedTabsOf } from "./restore-tabs";
import { newSession } from "./session-model";

const saved = (connectionId: string): SessionTarget => ({ type: "saved", connectionId });
// nas is an SSH connection, ad-01 an RDP one.
const nas = MOCK_IDS.nas;
const ad = MOCK_IDS.ad01;

describe("restoring tabs", () => {
  test("saved connections are kept in the row's order, quick targets never", () => {
    const quick: SessionTarget = { type: "quick", host: "10.5.5.5", port: 22, username: "root" };
    const sessions = [
      newSession("t1", "nas", saved(nas), "ssh"),
      newSession("t2", "10.5.5.5", quick, "ssh"),
      newSession("t3", "nas (2)", saved(nas), "sftp"),
      newSession("t4", "ad-01", saved(ad), "rdp"),
    ];
    expect(savedTabsOf(sessions)).toEqual([
      { connectionId: nas, kind: "ssh" },
      { connectionId: nas, kind: "sftp" },
      { connectionId: ad, kind: "rdp" },
    ]);
  });

  test("a deleted connection, or a tab that no longer fits its protocol, is skipped", () => {
    expect(
      restorable(
        [
          { connectionId: "a1000000-0000-4000-8000-0000000009ff", kind: "ssh" },
          { connectionId: nas, kind: "sftp" },
          { connectionId: nas, kind: "rdp" },
          { connectionId: ad, kind: "ssh" },
          { connectionId: ad, kind: "rdp" },
          { connectionId: nas, kind: "ssh" },
        ],
        MOCK_CONNECTIONS,
      ),
    ).toEqual([
      { connectionId: nas, kind: "sftp" },
      { connectionId: ad, kind: "rdp" },
      { connectionId: nas, kind: "ssh" },
    ]);
  });
});
