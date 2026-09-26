import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the shell with an active tab", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /Search or connect/ })).toBeInTheDocument();
  });

  it("hides the welcome screen while a tab is open", () => {
    render(<App />);
    expect(screen.queryByRole("heading", { name: "Welcome to TunL" })).not.toBeInTheDocument();
  });
});
