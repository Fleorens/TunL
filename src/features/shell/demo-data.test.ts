import { beforeEach, describe, expect, it } from "vitest";
import { INITIAL_TABS, useDemoTabs } from "./demo-data";

describe("useDemoTabs", () => {
  beforeEach(() => {
    useDemoTabs.setState({ tabs: INITIAL_TABS, activeId: "t1" });
  });

  it("activates the neighbour when closing the active tab", () => {
    useDemoTabs.getState().close("t1");
    expect(useDemoTabs.getState().activeId).toBe("t2");
  });

  it("gives activeId null when closing the last tab", () => {
    const state = useDemoTabs.getState();
    state.close("t1");
    state.close("t2");
    expect(useDemoTabs.getState().activeId).toBeNull();
  });

  it("wraps around: activateRelative(1) on the last tab goes to the first", () => {
    const state = useDemoTabs.getState();
    state.close("t1"); // only t2 remains, it is both first and last
    state.activateRelative(1);
    expect(useDemoTabs.getState().activeId).toBe("t2");
  });
});
