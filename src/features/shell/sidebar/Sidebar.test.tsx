import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEMO_CONNECTIONS, DEMO_GROUPS } from "@/features/shell/demo-data";
import { Sidebar } from "@/features/shell/sidebar/Sidebar";
import "@/i18n";

function renderSidebar() {
  return render(
    <TooltipProvider>
      <Sidebar connections={DEMO_CONNECTIONS} groups={DEMO_GROUPS} />
    </TooltipProvider>,
  );
}

describe("Sidebar", () => {
  it("highlights a single row across all sections", () => {
    renderSidebar();
    fireEvent.click(screen.getAllByRole("button", { name: /^nas/ })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /^pi-hole/ })[0]);

    const current = document.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("pi-hole");
  });

  it("opens the context menu with the groups on right click", () => {
    renderSidebar();
    fireEvent.contextMenu(screen.getAllByRole("button", { name: /^web-01/ })[0]);

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Connect" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Open in SFTP" })).toBeInTheDocument();
  });

  it("filters to a flat result list", () => {
    renderSidebar();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "pg" } });

    expect(screen.getByRole("heading", { name: "Results" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^db-prod/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^web-01/ })).toBeNull();
  });
});
