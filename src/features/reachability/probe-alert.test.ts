// T53: a probe that keeps failing warns once, and a success re-arms the warning.
import { toast } from "sonner";
import { afterEach, expect, test, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { useReachability } from "./store";

afterEach(() => {
  vi.restoreAllMocks();
  useReachability.setState({ results: {} });
});

test("repeated failures warn once until a success", async () => {
  const alert = vi.spyOn(toast, "error").mockImplementation(() => "toast");
  const probe = vi
    .spyOn(ipc, "probeCheck")
    .mockRejectedValue({ kind: "store", message: "blocked", detail: null });

  const refresh = useReachability.getState().refresh;
  await refresh(["a"]);
  await refresh(["a"]);
  await refresh(["a"]);
  expect(alert).toHaveBeenCalledTimes(1);

  probe.mockResolvedValueOnce([]);
  await refresh(["a"]);
  await refresh(["a"]);
  expect(alert).toHaveBeenCalledTimes(2);
});
