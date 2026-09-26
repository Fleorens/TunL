import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Wordmark } from "@/components/Logo";

describe("Wordmark", () => {
  it("shows the brand name", () => {
    const { container } = render(<Wordmark />);
    expect(container.textContent).toContain("TunL");
  });
});
