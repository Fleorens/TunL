// SFTP edits: the edits in progress, started from the menu, and the events that drive them (T57b).
// Pure store: every state update builds a new value, never mutates. The events come back through a callback
// (built as a `Channel` only in Tauri, T57); this store never builds one itself.

import { toast } from "sonner";
import type { StoreApi, UseBoundStore } from "zustand";
import { create } from "zustand";
import type { EditEvent } from "@/bindings/EditEvent";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
import { i18n } from "@/i18n";
import { notifyError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";

/** An edit's life: opening (the call went out), watching (each save is pushed), or a conflict on the server. */
export type EditStatus = "opening" | "watching" | "conflict";

/** One edit in progress, keyed by its id in `edits`. */
export interface Edit {
  id: string;
  sessionId: string;
  name: string;
  status: EditStatus;
}

interface EditsState {
  /** The edits in progress, keyed by id. */
  edits: Record<string, Edit>;

  /** Start editing `entry` on `sessionId`. The events drive the status until it closes. */
  edit: (sessionId: string, entry: RemoteEntry) => Promise<void>;

  /** Answer a conflict: `true` replaces the server's version, `false` sends nothing. */
  resolve: (id: string, overwrite: boolean) => Promise<void>;
}

export const useEdits: UseBoundStore<StoreApi<EditsState>> = create<EditsState>()((set) => {
  /** Apply one event to the edit of `id`, ignoring an edit already gone. `name` is captured for the toasts. */
  function apply(
    set: (update: (state: EditsState) => Partial<EditsState>) => void,
    id: string,
    name: string,
  ) {
    let status: EditStatus = "opening";
    return (event: EditEvent): void => {
      switch (event.type) {
        case "opened":
        case "saved":
          status = "watching";
          break;
        case "conflict":
          status = "conflict";
          break;
        case "failed":
          notifyError(event.error);
          return;
        case "closed":
          set((state) => {
            const edits = { ...state.edits };
            delete edits[id];
            return { edits };
          });
          return;
      }
      set((state) => ({ edits: { ...state.edits, [id]: { ...state.edits[id], status } } }));
      if (event.type === "opened") toast(i18n.t("sftp.edit.opened", { name }));
      if (event.type === "saved") toast(i18n.t("sftp.edit.saved", { name }));
    };
  }

  return {
    edits: {},

    async edit(sessionId, entry) {
      const id = crypto.randomUUID();
      set((state) => ({
        edits: { ...state.edits, [id]: { id, sessionId, name: entry.name, status: "opening" } },
      }));
      const onEvent = apply(set, id, entry.name);
      try {
        await ipc.sftpEdit(sessionId, id, entry.path, onEvent);
      } catch (error) {
        // A refused call (a closed tab, an unreadable file): report it, leave no edit behind.
        notifyError(error);
        set((state) => {
          const edits = { ...state.edits };
          delete edits[id];
          return { edits };
        });
      }
    },

    async resolve(id, overwrite) {
      // Back to watching before the call, so the dialog closes at once even if the push fails.
      set((state) => {
        const current = state.edits[id];
        if (!current) return {};
        return { edits: { ...state.edits, [id]: { ...current, status: "watching" } } };
      });
      try {
        await ipc.sftpEditResolve(id, overwrite);
      } catch (error) {
        notifyError(error);
      }
    },
  };
});

/** Above this size, a confirmation comes before the download: 10 MiB. */
export const EDIT_WARN_BYTES = 10 * 1024 * 1024;

/** A file, or a link to a file: the entries the menu offers to edit. */
export function isEditable(entry: RemoteEntry): boolean {
  if (entry.kind === "file") return true;
  return entry.kind === "symlink" && entry.targetKind === "file";
}
