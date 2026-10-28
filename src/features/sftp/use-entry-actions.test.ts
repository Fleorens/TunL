// T46: `busy` lasts from the delete's counting to its end, or its cancel, or an error — not to the dialog's close.
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
import { ipc } from "@/lib/ipc";
import { useEntryActions } from "./use-entry-actions";

const entry: RemoteEntry = {
  name: "logs",
  path: "/home/me/logs",
  kind: "dir",
  size: 0,
  modifiedAt: null,
  permissions: 0o755,
  hidden: false,
};

afterEach(() => {
  vi.restoreAllMocks();
});

/** Open the delete confirmation for `entry`, with a remove that answers only when `finish` is called. */
async function confirmationOpen() {
  vi.spyOn(ipc, "sftpCount").mockResolvedValue(3);
  let finish = (): void => {};
  vi.spyOn(ipc, "sftpRemove").mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const hook = renderHook(() => useEntryActions("session", "/home/me", () => {}));
  await act(() => hook.result.current.askDelete(entry));
  expect(hook.result.current.dialog?.type).toBe("delete");
  expect(hook.result.current.busy).toBe(true);
  return { hook, finish: () => finish() };
}

test("the close that follows a confirmation keeps busy until the remove answers", async () => {
  const { hook, finish } = await confirmationOpen();
  // Radix's confirm button runs `onConfirm`, then closes the dialog, which calls `onCancel`.
  let removing: Promise<void> = Promise.resolve();
  act(() => {
    removing = hook.result.current.remove(entry);
    hook.result.current.closeDialog();
  });
  expect(hook.result.current.dialog).toBeNull();
  expect(hook.result.current.busy).toBe(true);
  await act(async () => {
    finish();
    await removing;
  });
  expect(hook.result.current.busy).toBe(false);
});

test("closing another dialog during a delete keeps busy", async () => {
  const { hook, finish } = await confirmationOpen();
  let removing: Promise<void> = Promise.resolve();
  act(() => {
    removing = hook.result.current.remove(entry);
  });
  act(() => hook.result.current.permissions(entry));
  act(() => hook.result.current.closeDialog());
  expect(hook.result.current.busy).toBe(true);
  await act(async () => {
    finish();
    await removing;
  });
  expect(hook.result.current.busy).toBe(false);
});

test("cancelling the confirmation ends busy without removing", async () => {
  const { hook } = await confirmationOpen();
  act(() => hook.result.current.closeDialog());
  expect(hook.result.current.dialog).toBeNull();
  expect(hook.result.current.busy).toBe(false);
  expect(ipc.sftpRemove).not.toHaveBeenCalled();
});
