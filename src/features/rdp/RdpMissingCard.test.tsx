// T28b: an RDP tab without a FreeRDP 3 client says how to install one.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import "@/i18n";
import { INSTALL_COMMANDS, RdpMissingCard } from "./RdpMissingCard";

describe("RdpMissingCard", () => {
  test("lists an install command per family of distributions, each with a copy button", () => {
    render(<RdpMissingCard onRetry={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No FreeRDP 3 client found");
    for (const { distro, command } of INSTALL_COMMANDS) {
      expect(screen.getByText(command)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: `Copy the command for ${distro}` }),
      ).toBeInTheDocument();
    }
    expect(INSTALL_COMMANDS.map((c) => c.command)).toContain("sudo apt install freerdp3-sdl");
  });

  test("Retry and Close tab call back", () => {
    const onRetry = vi.fn();
    const onClose = vi.fn();
    render(<RdpMissingCard onRetry={onRetry} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Close tab" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
