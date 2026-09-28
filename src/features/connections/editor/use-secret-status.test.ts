import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { failNextCall, resetMockBackend } from "@/lib/ipc-mock";
import { MOCK_IDS } from "@/lib/mock/data";
import { useSecretStatus } from "./use-secret-status";

beforeEach(() => {
  resetMockBackend();
});

test("a connection being created has no secret, without asking the backend", () => {
  const { result } = renderHook(() => useSecretStatus(null, "password"));
  expect(result.current).toBe("none");
});

test("loading, then saved or none", async () => {
  const saved = renderHook(() => useSecretStatus(MOCK_IDS.ad01, "password"));
  expect(saved.result.current).toBe("loading");
  await waitFor(() => expect(saved.result.current).toBe("saved"));
  const none = renderHook(() => useSecretStatus(MOCK_IDS.web01, "password"));
  await waitFor(() => expect(none.result.current).toBe("none"));
});

test("a keyring error means unavailable", async () => {
  failNextCall("secret_has", {
    kind: "secret",
    message: "system keyring unavailable",
    detail: null,
  });
  const { result } = renderHook(() => useSecretStatus(MOCK_IDS.ad01, "password"));
  await waitFor(() => expect(result.current).toBe("unavailable"));
});
