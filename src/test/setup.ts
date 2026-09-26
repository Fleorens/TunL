import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom implements neither matchMedia nor ResizeObserver; Radix and our theme code need them.
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe(): void {
      // no-op in jsdom
    }
    unobserve(): void {
      // no-op in jsdom
    }
    disconnect(): void {
      // no-op in jsdom
    }
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: ResizeObserverStub,
  });
}

// @testing-library/react v16 does not unmount between tests; otherwise rendered
// components accumulate and break getByRole / getByByText lookups.
afterEach(() => {
  cleanup();
});
