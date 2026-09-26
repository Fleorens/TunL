import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProtocolBadge } from "@/components/ProtocolBadge";

describe("ProtocolBadge", () => {
  it("shows the protocol name", () => {
    render(<ProtocolBadge protocol="ssh" />);
    expect(screen.getByText("ssh")).toBeInTheDocument();
  });
});
