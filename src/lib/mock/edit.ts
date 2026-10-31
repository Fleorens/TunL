// Mock handlers for the edit commands (T57): a remote file is opened locally in a private folder, then its
// first save is pushed back in place. A save lands, except for a `.bashrc` file in the mock, which always
// changed on the server meanwhile and so asks the UI to overwrite (conflict).
import type { AppError } from "@/bindings/AppError";
import type { EditEvent } from "@/bindings/EditEvent";
import type { Handler } from "./data";
import { arg } from "./data";
import { mockRemoteNode } from "./sftp";

/** How long an edit stays "opened" before its first push (the sheet's 300 ms). */
const MOCK_EDIT_SAVE_MS = 300;

/** The private folder every edited file is fetched into (D17, docs/03-design.md). */
const EDIT_ROOT = "/run/user/1000/tunl/edit";

/** One open edit, so a resolve can find it and know whether it is in conflict. */
interface ActiveEdit {
  conflicted: boolean;
  onEvent: (event: EditEvent) => void;
}

/** Every open edit, by edit id. */
const active = new Map<string, ActiveEdit>();

function validation(message: string): AppError {
  return { kind: "validation", message, detail: null };
}

/** The base name of a path, without its directory. */
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The local path a file is fetched into, inside its edit's private folder. */
function localPath(editId: string, remotePath: string): string {
  return `${EDIT_ROOT}/${editId}/${nameOf(remotePath)}`;
}

/**
 * Emit the first push `MOCK_EDIT_SAVE_MS` after the edit opened. The edit was closed meanwhile: nothing is
 * reported (the backend task already pushed, or the tab is gone).
 */
async function runAfterSave(
  editId: string,
  onEvent: (event: EditEvent) => void,
  emit: "saved" | "conflict",
): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, MOCK_EDIT_SAVE_MS));
  const edit = active.get(editId);
  if (!edit) return;
  if (emit === "conflict") {
    onEvent({ type: "conflict" });
  } else {
    edit.conflicted = false;
    onEvent({ type: "saved" });
  }
}

export const editHandlers: Record<string, Handler<Record<string, unknown>>> = {
  sftp_edit: (state, args) => {
    const { editId, sessionId, remotePath, onEvent } = arg<{
      editId: string;
      sessionId: string;
      remotePath: string;
      onEvent: (event: EditEvent) => void;
    }>(args);
    // `notFound` when the tab is not connected (like the other tab commands); `undefined` when the path is
    // absent. `mockRemoteNode` throws `notFound` itself for a disconnected tab (its `homeOf` is outside the
    // try), else returns the node or `undefined`.
    const node = mockRemoteNode(sessionId, remotePath);
    if (node === undefined) throw validation("no such file");
    if (node.kind !== "file") throw validation("not a file");
    const path = localPath(editId, remotePath);
    if (nameOf(remotePath) === ".bashrc") {
      // A `.bashrc` always changed on the server meanwhile: it opens, then asks to overwrite.
      active.set(editId, { conflicted: true, onEvent });
      void runAfterSave(editId, onEvent, "conflict");
    } else {
      active.set(editId, { conflicted: false, onEvent });
      void runAfterSave(editId, onEvent, "saved");
    }
    return { state, result: { editId, path } };
  },
  sftp_edit_resolve: (state, args) => {
    const { editId, overwrite } = arg<{ editId: string; overwrite: boolean }>(args);
    const edit = active.get(editId);
    // Answering an unknown edit, or one not in conflict, is not an error: nothing happens.
    if (!edit || !overwrite || !edit.conflicted) return { state, result: null };
    // The UI accepted the overwrite: the push lands 300 ms later, like a fresh save.
    edit.conflicted = false;
    void runAfterSave(editId, edit.onEvent, "saved");
    return { state, result: null };
  },
};

/** Forget every open edit, for `resetMockBackend()`. */
export function resetMockEdits(): void {
  active.clear();
}
