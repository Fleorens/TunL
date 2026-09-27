import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useConnections } from "@/features/connections/store";
import { Sidebar } from "@/features/shell/sidebar/Sidebar";
import { failNextCall, resetMockBackend } from "@/lib/ipc-mock";
import "@/i18n";

function renderSidebar() {
  return render(
    <TooltipProvider>
      <Sidebar />
    </TooltipProvider>,
  );
}

beforeEach(async () => {
  resetMockBackend();
  await useConnections.getState().load();
});

describe("Sidebar", () => {
  it("renders each section as a labelled region", () => {
    renderSidebar();
    const favorites = screen.getByRole("region", { name: "Favorites" });
    expect(within(favorites).getByRole("button", { name: /^web-01/ })).toBeInTheDocument();
    const homelab = screen.getByRole("region", { name: "Homelab" });
    const homelabRows = within(homelab).getAllByRole("button", {
      name: /^(nas|pi-hole|media-server|win-desktop)/,
    });
    expect(homelabRows).toHaveLength(4);
    const ungrouped = screen.getByRole("region", { name: "Ungrouped" });
    expect(within(ungrouped).getAllByRole("button", { name: /^(router|kiosk-01)/ })).toHaveLength(
      2,
    );
  });

  it("highlights a single row across all sections", () => {
    renderSidebar();
    fireEvent.click(screen.getAllByRole("button", { name: /^nas/ })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /^pi-hole/ })[0]);
    const current = document.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("pi-hole");
  });

  it("filters to a flat result list", () => {
    renderSidebar();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "pg" } });
    expect(screen.getByRole("heading", { name: "Results" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^db-prod/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^web-01/ })).toBeNull();
  });

  it("offers the wake-up action only for connections with Wake-on-LAN", () => {
    renderSidebar();
    fireEvent.contextMenu(screen.getAllByRole("button", { name: /^win-desktop/ })[0]);
    expect(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Wake up" }),
    ).toBeInTheDocument();
  });

  it("shows the load error with a retry button", async () => {
    failNextCall("store_load", { kind: "store", message: "created by a newer TunL", detail: null });
    await useConnections.getState().load();
    renderSidebar();
    expect(screen.getByText("Connections could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("created by a newer TunL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
