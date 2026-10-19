// Mock handler for `rdp_detect`: the FreeRDP 3 client the UI of T28 and T31 sees in the browser.
import type { AppError } from "@/bindings/AppError";
import type { RdpClient } from "@/bindings/RdpClient";
import type { Handler, MockState } from "./data";

/** The client the mock reports by default: an SDL build of FreeRDP 3.10.3. */
export const MOCK_RDP_CLIENT: RdpClient = {
  path: "/usr/bin/sdl-freerdp3",
  version: "3.10.3",
  flavor: "sdl",
};

/** The flavor of a forced path, from its file name (an unknown name is taken for SDL). */
function flavorOf(path: string): RdpClient["flavor"] {
  if (path.includes("wlfreerdp")) return "wayland";
  if (path.includes("xfreerdp")) return "x11";
  return "sdl";
}

/** The error the backend returns when a forced path is not a FreeRDP 3 client. */
function missing(path: string): AppError {
  return {
    kind: "rdpClientMissing",
    message: `${path} is not a FreeRDP 3 client`,
    detail: null,
  };
}

/** Resolve the FreeRDP 3 client the UI would launch with: the default, or a forced path (this sheet). */
export function detectClient(state: MockState): RdpClient {
  const clientPath = state.settings.rdp.clientPath;

  // No forced path: the default client.
  if (!clientPath) return MOCK_RDP_CLIENT;

  // A forced path that is not FreeRDP is a missing client.
  if (!clientPath.includes("freerdp")) throw missing(clientPath);

  // A FreeRDP path is used as is, with its flavor from the name.
  return { path: clientPath, version: "3.10.3", flavor: flavorOf(clientPath) };
}

export const rdpHandlers: Record<string, Handler> = {
  rdp_detect(state) {
    return { state, result: detectClient(state) };
  },
};
