import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SectionHeader } from "@/components/SectionHeader";

describe("SectionHeader", () => {
  it("renders its title as a heading", () => {
    render(<SectionHeader title="Connections" />);
    expect(screen.getByRole("heading", { name: "Connections" })).toBeInTheDocument();
  });

  it("renders its optional action", () => {
    render(<SectionHeader title="Connections" action={<button type="button">Add</button>} />);
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });
});
