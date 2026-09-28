import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useConnections } from "@/features/connections/store";
import { resetMockBackend } from "@/lib/ipc-mock";
import { HomeView } from "./HomeView";
import "@/i18n";

beforeEach(async () => {
  resetMockBackend();
  await useConnections.getState().load();
});

test("with no connection at all, the first-launch screen guides the user", () => {
  useConnections.setState({ connections: [] });
  render(
    <TooltipProvider>
      <HomeView />
    </TooltipProvider>,
  );
  expect(screen.getByText("Welcome to TunL")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Import ~/.ssh/config" })).toBeInTheDocument();
  expect(screen.queryByPlaceholderText("user@host[:port] — quick connect")).toBeNull();
});
