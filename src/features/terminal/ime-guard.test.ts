import { describe, expect, test } from "vitest";
import { guardOrphanCompositionEnd } from "./ime-guard";

// A host element (xterm opens into it) containing a textarea, whose own compositionend listener
// counts how many times the event reaches xterm. The guard listens on the host, one level up.
function makeHost(): {
  host: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  reached: () => number;
} {
  const host = document.createElement("div");
  const textarea = document.createElement("textarea");
  let reached = 0;
  textarea.addEventListener("compositionend", () => {
    reached += 1;
  });
  host.appendChild(textarea);
  document.body.appendChild(host);
  return {
    host,
    textarea,
    reached: () => reached,
  };
}

function compositionEvent(type: "compositionstart" | "compositionend", data: string): Event {
  // jsdom may lack CompositionEvent; fall back to Event (data is ignored then).
  if (typeof CompositionEvent !== "undefined") {
    return new CompositionEvent(type, { bubbles: true, data });
  }
  return new Event(type, { bubbles: true });
}

describe("guardOrphanCompositionEnd", () => {
  test("an orphan compositionend (no compositionstart) never reaches the terminal, twice in a row", () => {
    const { host, textarea, reached } = makeHost();
    const unguard = guardOrphanCompositionEnd(host);

    textarea.dispatchEvent(compositionEvent("compositionend", "s"));
    textarea.dispatchEvent(compositionEvent("compositionend", "s"));

    expect(reached()).toBe(0);
    unguard();
    document.body.removeChild(host);
  });

  test("a real composition (start then end) is left to the terminal", () => {
    const { host, textarea, reached } = makeHost();
    const unguard = guardOrphanCompositionEnd(host);

    textarea.dispatchEvent(compositionEvent("compositionstart", "l"));
    textarea.dispatchEvent(compositionEvent("compositionend", "ls"));

    expect(reached()).toBe(1);
    unguard();
    document.body.removeChild(host);
  });

  test("after teardown, an orphan compositionend reaches the terminal again", () => {
    const { host, textarea, reached } = makeHost();
    const unguard = guardOrphanCompositionEnd(host);
    unguard();

    textarea.dispatchEvent(compositionEvent("compositionend", "s"));

    expect(reached()).toBe(1);
    document.body.removeChild(host);
  });
});
