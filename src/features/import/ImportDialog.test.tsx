import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useConnections } from "@/features/connections/store";
import { useUi } from "@/features/shell/ui-store";
import { failNextCall, resetMockBackend } from "@/lib/ipc-mock";
import { ImportDialog } from "./ImportDialog";
import "@/i18n";

beforeEach(async () => {
  resetMockBackend();
  await useConnections.getState().load();
});

test("a missing ~/.ssh/config gets a friendly message, not an error toast", async () => {
  failNextCall("import_ssh_config_preview", {
    kind: "notFound",
    message: "ssh config ~/.ssh/config not found",
    detail: null,
  });
  useUi.getState().openImport();
  render(
    <TooltipProvider>
      <ImportDialog />
    </TooltipProvider>,
  );
  expect(await screen.findByText("No SSH config found")).toBeInTheDocument();
  expect(screen.getByText("TunL reads ~/.ssh/config.")).toBeInTheDocument();
});
