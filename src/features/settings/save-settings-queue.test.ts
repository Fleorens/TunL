// T53 review: a queued change never brings back a stale state (one saved elsewhere, or one the backend refused).
import { afterEach, expect, test, vi } from "vitest";
import type { Settings } from "@/bindings/Settings";
import { ipc } from "@/lib/ipc";
import { saveSettings } from "./save-settings";
import { useSettings } from "./store";

afterEach(() => {
  vi.restoreAllMocks();
});

test("a change saved outside the queue is kept by the next one", async () => {
  const initial = await ipc.settingsGet();
  useSettings.setState({ settings: initial });
  vi.spyOn(ipc, "settingsUpdate").mockImplementation(async (next) => next);

  const motion = initial.reduceMotion === "on" ? "off" : "on";
  expect(await saveSettings((s) => ({ ...s, reduceMotion: motion }))).toBe(true);
  // The palette writes the theme through the store, not through saveSettings.
  const theme = initial.theme === "dark" ? "light" : "dark";
  const current = useSettings.getState().settings;
  if (!current) throw new Error("settings not loaded");
  await useSettings.getState().update({ ...current, theme });
  const copy = !initial.terminal.copyOnSelect;
  expect(
    await saveSettings((s) => ({ ...s, terminal: { ...s.terminal, copyOnSelect: copy } })),
  ).toBe(true);

  expect(useSettings.getState().settings?.theme).toBe(theme);
  expect(useSettings.getState().settings?.reduceMotion).toBe(motion);
  expect(useSettings.getState().settings?.terminal.copyOnSelect).toBe(copy);
});

test("a refused change is not sent again with the next one", async () => {
  const initial = await ipc.settingsGet();
  useSettings.setState({ settings: initial });
  const sent: Settings[] = [];
  vi.spyOn(ipc, "settingsUpdate").mockImplementation(async (next) => {
    sent.push(next);
    if (sent.length === 1) throw new Error("disk full");
    return next;
  });

  const motion = initial.reduceMotion === "on" ? "off" : "on";
  const copy = !initial.terminal.copyOnSelect;
  const first = saveSettings((s) => ({ ...s, reduceMotion: motion }));
  const second = saveSettings((s) => ({ ...s, terminal: { ...s.terminal, copyOnSelect: copy } }));
  expect(await Promise.all([first, second])).toEqual([false, true]);

  expect(sent[1]?.reduceMotion).toBe(initial.reduceMotion);
  expect(useSettings.getState().settings?.reduceMotion).toBe(initial.reduceMotion);
  expect(useSettings.getState().settings?.terminal.copyOnSelect).toBe(copy);
});
