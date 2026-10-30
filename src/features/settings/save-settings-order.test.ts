// T53: two changes made before the first one is saved are both kept, in order.
import { afterEach, expect, test, vi } from "vitest";
import type { Settings } from "@/bindings/Settings";
import { ipc } from "@/lib/ipc";
import { saveSettings } from "./save-settings";
import { useSettings } from "./store";

afterEach(() => {
  vi.restoreAllMocks();
});

test("two quick changes are both kept", async () => {
  const initial = await ipc.settingsGet();
  useSettings.setState({ settings: initial });
  const sent: Settings[] = [];
  vi.spyOn(ipc, "settingsUpdate").mockImplementation(async (next) => {
    sent.push(next);
    await new Promise((resolve) => setTimeout(resolve, 10));
    return next;
  });

  const copy = !initial.terminal.copyOnSelect;
  const motion = initial.reduceMotion === "on" ? "off" : "on";
  const first = saveSettings((s) => ({ ...s, terminal: { ...s.terminal, copyOnSelect: copy } }));
  const second = saveSettings((s) => ({ ...s, reduceMotion: motion }));
  expect(await Promise.all([first, second])).toEqual([true, true]);

  expect(sent).toHaveLength(2);
  expect(sent[1]?.terminal.copyOnSelect).toBe(copy);
  expect(sent[1]?.reduceMotion).toBe(motion);
  expect(useSettings.getState().settings?.terminal.copyOnSelect).toBe(copy);
  expect(useSettings.getState().settings?.reduceMotion).toBe(motion);
});
