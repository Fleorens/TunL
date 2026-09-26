import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusDot } from "@/components/StatusDot";

describe("StatusDot", () => {
  it("renders a labeled dot", () => {
    render(<StatusDot status="online" label="Online" />);
    expect(screen.getByRole("img", { name: "Online" })).toBeInTheDocument();
  });

  it("pulses when connecting", () => {
    render(<StatusDot status="connecting" label="Connecting" />);
    const dot = screen.getByRole("img", { name: "Connecting" });
    expect(dot.querySelector(".animate-tunl-pulse")).toBeInTheDocument();
  });

  it("does not pulse when online", () => {
    render(<StatusDot status="online" label="Online" />);
    const dot = screen.getByRole("img", { name: "Online" });
    expect(dot.querySelector(".animate-tunl-pulse")).toBeNull();
  });
});
