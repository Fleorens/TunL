// T60: the offered tabs reopen with their own kind, in order, the first one active.
import { beforeEach, describe, expect, it } from "vitest";
import { useConnections } from "@/features/connections/store";
import { resetMockBackend } from "@/lib/ipc-mock";
import { useRestore } from "./restore-store";
import { useSessions } from "./store";

function firstOf(protocol: "ssh" | "rdp") {
  const found = useConnections
    .getState()
    .connections.find((connection) => connection.settings.protocol === protocol);
  if (!found) throw new Error(`no ${protocol} connection`);
  return found;
}

beforeEach(async () => {
  resetMockBackend();
  useSessions.setState({ sessions: [], activeId: null });
  await useConnections.getState().load();
});

describe("useRestore.openOffer", () => {
  it("reopens an RDP tab as an RDP tab, and an SFTP tab as an SFTP tab, in order", () => {
    const rdp = firstOf("rdp");
    const ssh = firstOf("ssh");
    useRestore.setState({
      offer: [
        { connectionId: rdp.id, kind: "rdp" },
        { connectionId: ssh.id, kind: "sftp" },
        { connectionId: ssh.id, kind: "ssh" },
      ],
    });

    useRestore.getState().openOffer();

    const { sessions, activeId } = useSessions.getState();
    expect(sessions.map((session) => [session.connectionId, session.kind])).toEqual([
      [rdp.id, "rdp"],
      [ssh.id, "sftp"],
      [ssh.id, "ssh"],
    ]);
    expect(activeId).toBe(sessions[0]?.id);
    expect(useRestore.getState().offer).toEqual([]);
  });
});
