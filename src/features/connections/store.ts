import { toast } from "sonner";
import { create } from "zustand";
import type { AppError } from "@/bindings/AppError";
import type { Connection } from "@/bindings/Connection";
import type { ConnectionInput } from "@/bindings/ConnectionInput";
import type { ConnectionTemplates } from "@/bindings/ConnectionTemplates";
import type { Group } from "@/bindings/Group";
import type { GroupInput } from "@/bindings/GroupInput";
import type { StoreSnapshot } from "@/bindings/StoreSnapshot";
import { toInput } from "@/features/connections/to-input";
import { i18n } from "@/i18n";
import { notifyError, toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import type { Result } from "@/lib/result";

type LoadStatus = "idle" | "loading" | "ready" | "error";

interface ConnectionsState {
  status: LoadStatus;
  loadError: AppError | null;
  groups: readonly Group[];
  connections: readonly Connection[];
  templates: ConnectionTemplates | null;
  quarantined: readonly string[];

  /** Load the snapshot and the templates in parallel. */
  load: () => Promise<void>;
  /** Called from forms: return the error, no toast (the form shows it under the field). */
  create: (input: ConnectionInput) => Promise<Result<Connection>>;
  update: (id: string, input: ConnectionInput) => Promise<Result<Connection>>;
  createGroup: (input: GroupInput) => Promise<Result<Group>>;
  updateGroup: (id: string, input: GroupInput) => Promise<Result<Group>>;
  /** Called from menus: on failure, notifyError() then false / null. */
  duplicate: (id: string) => Promise<Connection | null>;
  remove: (id: string) => Promise<boolean>;
  setFavorite: (id: string, favorite: boolean) => Promise<boolean>;
  moveToGroup: (id: string, groupId: string | null) => Promise<boolean>;
  /** Replaces both groups and connections (the group's connections become ungrouped). */
  removeGroup: (id: string) => Promise<boolean>;
  /** Replaces `groups` and `connections` from a snapshot at once (import apply, group delete). */
  replaceSnapshot: (snapshot: StoreSnapshot) => void;
  /** Marks a connection recently used (the home "Recents"); replaces it, or notifies on failure. */
  touch: (id: string) => Promise<Connection | null>;
  moveGroup: (id: string, delta: -1 | 1) => Promise<boolean>;
}

export const useConnections = create<ConnectionsState>()((set) => ({
  status: "idle",
  loadError: null,
  groups: [],
  connections: [],
  templates: null,
  quarantined: [],

  replaceSnapshot(snapshot) {
    set({ groups: snapshot.groups, connections: snapshot.connections });
  },

  async touch(id) {
    try {
      const connection = await ipc.connectionTouch(id);
      set((state) => ({
        connections: state.connections.map((c) => (c.id === id ? connection : c)),
      }));
      return connection;
    } catch (error) {
      notifyError(error);
      return null;
    }
  },

  async load() {
    set({ status: "loading", loadError: null });

    // The two reads are independent: a quarantine note must not hide a templates failure, and
    // vice versa. allSettled lets each resolve on its own.
    const [storeResult, templatesResult] = await Promise.allSettled([
      ipc.storeLoad(),
      ipc.connectionTemplates(),
    ]);

    if (storeResult.status === "rejected") {
      set({ status: "error", loadError: toAppError(storeResult.reason) });
      return;
    }

    const snapshot: StoreSnapshot = storeResult.value;
    const templates =
      templatesResult.status === "fulfilled" ? (templatesResult.value ?? null) : null;

    set({
      status: "ready",
      groups: snapshot.groups,
      connections: snapshot.connections,
      quarantined: snapshot.quarantined,
      templates,
    });

    if (snapshot.quarantined.length > 0) {
      // A quarantine path is not a secret, but the user must not lose the fact that a file
      // was moved aside. Keep each toast visible (duration Infinity) so it is not swept away.
      snapshot.quarantined.forEach((path) => {
        toast.warning(i18n.t("connections.quarantined", { path }), { duration: Infinity });
      });
    }
  },

  async create(input) {
    try {
      const connection = await ipc.connectionCreate(input);
      set((state) => ({ connections: [...state.connections, connection] }));
      return { ok: true, value: connection };
    } catch (error) {
      return { ok: false, error: toAppError(error) };
    }
  },

  async update(id, input) {
    try {
      const connection = await ipc.connectionUpdate(id, input);
      set((state) => ({
        connections: state.connections.map((c) => (c.id === id ? connection : c)),
      }));
      return { ok: true, value: connection };
    } catch (error) {
      return { ok: false, error: toAppError(error) };
    }
  },

  async createGroup(input) {
    try {
      const group = await ipc.groupCreate(input);
      set((state) => ({ groups: [...state.groups, group] }));
      return { ok: true, value: group };
    } catch (error) {
      return { ok: false, error: toAppError(error) };
    }
  },

  async updateGroup(id, input) {
    try {
      const group = await ipc.groupUpdate(id, input);
      set((state) => ({ groups: state.groups.map((g) => (g.id === id ? group : g)) }));
      return { ok: true, value: group };
    } catch (error) {
      return { ok: false, error: toAppError(error) };
    }
  },

  async duplicate(id) {
    try {
      const connection = await ipc.connectionDuplicate(id);
      set((state) => ({ connections: [...state.connections, connection] }));
      return connection;
    } catch (error) {
      notifyError(error);
      return null;
    }
  },

  async remove(id) {
    try {
      await ipc.connectionDelete(id);
      set((state) => ({ connections: state.connections.filter((c) => c.id !== id) }));
      return true;
    } catch (error) {
      notifyError(error);
      return false;
    }
  },

  async setFavorite(id, favorite) {
    try {
      const connection = await ipc.connectionSetFavorite(id, favorite);
      set((state) => ({
        connections: state.connections.map((c) => (c.id === id ? connection : c)),
      }));
      return true;
    } catch (error) {
      notifyError(error);
      return false;
    }
  },

  async moveToGroup(id, groupId) {
    try {
      const current = useConnections.getState().connections.find((c) => c.id === id);
      if (!current) return false;
      const input = toInput(current);
      input.groupId = groupId;
      const connection = await ipc.connectionUpdate(id, input);
      set((state) => ({
        connections: state.connections.map((c) => (c.id === id ? connection : c)),
      }));
      return true;
    } catch (error) {
      notifyError(error);
      return false;
    }
  },

  async removeGroup(id) {
    try {
      // group_delete returns a full snapshot: replace both groups and connections at once.
      const snapshot = await ipc.groupDelete(id);
      useConnections.getState().replaceSnapshot(snapshot);
      return true;
    } catch (error) {
      notifyError(error);
      return false;
    }
  },

  async moveGroup(id, delta) {
    try {
      const current = useConnections.getState().groups;
      const index = current.findIndex((g) => g.id === id);
      if (index === -1) return false;
      const target = index + delta;
      if (target < 0 || target >= current.length) return false;

      const ids = current.map((g) => g.id);
      // delta is -1 or 1, so a single adjacent swap is a full permutation.
      [ids[index], ids[target]] = [ids[target], ids[index]];
      const groups = await ipc.groupReorder(ids);
      set({ groups });
      return true;
    } catch (error) {
      notifyError(error);
      return false;
    }
  },
}));
