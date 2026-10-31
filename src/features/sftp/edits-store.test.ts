// T57b: an edit's life in the store, from the backend's events, and the entries that can be edited.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EditEvent } from "@/bindings/EditEvent";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
import { ipc } from "@/lib/ipc";
import { isEditable, useEdits } from "./edits-store";

const notes: RemoteEntry = {
  name: "notes.txt",
  path: "/home/me/notes.txt",
  kind: "file",
  size: 512,
  modifiedAt: null,
  permissions: 0o644,
  hidden: false,
};

let send: (event: EditEvent) => void = () => {};

beforeEach(() => {
  useEdits.setState({ edits: {} });
  vi.spyOn(ipc, "sftpEdit").mockImplementation(async (_session, _id, _path, onEvent) => {
    send = onEvent;
  });
  vi.spyOn(ipc, "sftpEditResolve").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function only() {
  return Object.values(useEdits.getState().edits)[0];
}

describe("edits", () => {
  test("opened, conflict, resolved, then closed", async () => {
    await useEdits.getState().edit("tab-1", notes);
    expect(only()).toMatchObject({ sessionId: "tab-1", name: "notes.txt", status: "opening" });

    send({ type: "opened", localPath: "/run/user/1000/tunl/edit/x/notes.txt" });
    expect(only().status).toBe("watching");
    send({ type: "conflict" });
    expect(only().status).toBe("conflict");

    await useEdits.getState().resolve(only().id, true);
    expect(only().status).toBe("watching");
    expect(ipc.sftpEditResolve).toHaveBeenCalledWith(only().id, true);

    send({ type: "closed" });
    expect(useEdits.getState().edits).toEqual({});
  });

  test("a refused call leaves no edit behind", async () => {
    vi.spyOn(ipc, "sftpEdit").mockRejectedValue({ kind: "notFound", message: "x", detail: null });
    await useEdits.getState().edit("tab-1", notes);
    expect(useEdits.getState().edits).toEqual({});
  });

  test("a file or a link to a file can be edited, nothing else", () => {
    expect(isEditable(notes)).toBe(true);
    expect(isEditable({ ...notes, kind: "symlink", targetKind: "file" })).toBe(true);
    expect(isEditable({ ...notes, kind: "symlink", targetKind: "dir" })).toBe(false);
    expect(isEditable({ ...notes, kind: "dir" })).toBe(false);
    expect(isEditable({ ...notes, kind: "other" })).toBe(false);
  });
});
