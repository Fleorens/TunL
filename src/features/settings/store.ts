import { create } from "zustand";
import type { Settings } from "@/bindings/Settings";
import { notifyError, toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import type { Result } from "@/lib/result";

interface SettingsState {
  settings: Settings | null;
  load: () => Promise<void>;
  update: (next: Settings) => Promise<Result<Settings>>;
}

export const useSettings = create<SettingsState>()((set) => ({
  settings: null,

  async load() {
    try {
      const settings = await ipc.settingsGet();
      set({ settings });
    } catch (error) {
      notifyError(error);
    }
  },

  async update(next) {
    try {
      const settings = await ipc.settingsUpdate(next);
      set({ settings });
      return { ok: true, value: settings };
    } catch (error) {
      return { ok: false, error: toAppError(error) };
    }
  },
}));
