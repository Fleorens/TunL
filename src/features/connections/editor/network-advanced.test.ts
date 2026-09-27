import { describe, expect, it } from "vitest";
import type { AppError } from "@/bindings/AppError";
import type { ConnectionInput } from "@/bindings/ConnectionInput";
import type { ConnectionTemplates } from "@/bindings/ConnectionTemplates";
import {
  backendFieldError,
  type ConnectionFormValues,
  connectionFormSchema,
  toConnectionInput,
  toFormValues,
} from "./form-values";
import { normalizeMac } from "./validation";

const common = {
  name: "",
  host: "",
  username: null,
  groupId: null,
  tags: [],
  favorite: false,
  color: null,
  notes: null,
  jumpHostId: null,
  wol: null,
} satisfies Partial<ConnectionInput>;

const rdpDefaults = {
  protocol: "rdp",
  domain: null,
  display: { mode: "fit" },
  multimon: false,
  dynamicResolution: true,
  clipboard: true,
  audio: "local",
  shareHome: false,
  certPolicy: "prompt",
  extraArgs: [],
} satisfies ConnectionInput["settings"];

const templates: ConnectionTemplates = {
  ssh: {
    ...common,
    port: 22,
    settings: {
      protocol: "ssh",
      auth: { method: "password" },
      keepaliveSecs: null,
      connectTimeoutSecs: null,
    },
  },
  rdp: { ...common, port: 3389, settings: { ...rdpDefaults, extraArgs: [] } },
  wol: {
    mac: "",
    broadcast: "255.255.255.255",
    port: 9,
    wakeBeforeConnect: false,
    waitTimeoutSecs: 120,
  },
};

function sshValues(patch: Partial<ConnectionFormValues> = {}): ConnectionFormValues {
  return { ...toFormValues(templates.ssh, templates), name: "web-01", host: "10.0.0.12", ...patch };
}

function rdpValues(patch: Partial<ConnectionFormValues> = {}): ConnectionFormValues {
  return { ...toFormValues(templates.rdp, templates), name: "win", host: "10.0.0.5", ...patch };
}

function issuesOf(values: ConnectionFormValues): Record<string, string> {
  const result = connectionFormSchema.safeParse(values);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
  );
}

describe("network and advanced fields", () => {
  it("maps the RDP settings", () => {
    const values = rdpValues({
      rdpDisplayMode: "fixed",
      rdpWidth: "1920",
      rdpHeight: "1080",
      rdpAudio: "off",
      rdpCertPolicy: "tofu",
      rdpClipboard: false,
      rdpExtraArgs: ["+fonts"],
    });
    expect(toConnectionInput(values, templates.rdp, templates).settings).toEqual({
      ...rdpDefaults,
      display: { mode: "fixed", width: 1920, height: 1080 },
      clipboard: false,
      audio: "off",
      certPolicy: "tofu",
      extraArgs: ["+fonts"],
    });
  });

  it("fills the form from a fixed-size RDP connection", () => {
    const input: ConnectionInput = {
      ...templates.rdp,
      settings: {
        ...rdpDefaults,
        domain: "CORP",
        display: { mode: "fixed", width: 1280, height: 720 },
        extraArgs: [],
      },
    };
    expect(toFormValues(input, templates)).toMatchObject({
      rdpDomain: "CORP",
      rdpDisplayMode: "fixed",
      rdpWidth: "1280",
      rdpHeight: "720",
      wolEnabled: false,
      wolBroadcast: "255.255.255.255",
      sshKeepaliveSecs: "",
    });
  });

  it("maps Wake-on-LAN and normalizes the MAC address", () => {
    const on = sshValues({
      wolEnabled: true,
      wolMac: "aa-bb-cc-dd-ee-ff",
      wolWakeBeforeConnect: true,
      wolWaitTimeoutSecs: "60",
    });
    expect(toConnectionInput(on, templates.ssh, templates).wol).toEqual({
      mac: "AA:BB:CC:DD:EE:FF",
      broadcast: "255.255.255.255",
      port: 9,
      wakeBeforeConnect: true,
      waitTimeoutSecs: 60,
    });
    const off = sshValues({ wolEnabled: false, wolMac: "aa-bb-cc-dd-ee-ff" });
    expect(toConnectionInput(off, templates.ssh, templates).wol).toBeNull();
  });

  it("maps the jump host and the SSH timeouts, empty meaning the global setting", () => {
    const values = sshValues({
      jumpHostId: "j-1",
      sshKeepaliveSecs: "15",
      sshConnectTimeoutSecs: "",
    });
    const input = toConnectionInput(values, templates.ssh, templates);
    expect(input.jumpHostId).toBe("j-1");
    expect(input.settings).toMatchObject({
      protocol: "ssh",
      keepaliveSecs: 15,
      connectTimeoutSecs: null,
    });
    expect(
      toConnectionInput(sshValues({ jumpHostId: "" }), templates.ssh, templates).jumpHostId,
    ).toBeNull();
  });

  it("normalizes MAC addresses like the backend", () => {
    expect(normalizeMac("aa-bb-cc-dd-ee-ff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normalizeMac(" aabbccddeeff ")).toBe("AA:BB:CC:DD:EE:FF");
    for (const bad of [
      "",
      "aa:bb:cc:dd:ee",
      "aa:bb:cc:dd:ee:gg",
      "aa:bb-cc:dd:ee:ff",
      "aabbccddeeff00",
    ]) {
      expect(normalizeMac(bad)).toBeNull();
    }
  });

  it("attaches the new backend paths to their fields", () => {
    const error: AppError = {
      kind: "validation",
      message: "jumpHostId: creates a cycle",
      detail: null,
    };
    expect(backendFieldError(error)).toEqual({ field: "jumpHostId", message: "creates a cycle" });
    const mac: AppError = { ...error, message: "wol.mac: invalid MAC address" };
    expect(backendFieldError(mac)).toEqual({ field: "wolMac", message: "invalid MAC address" });
  });
});

describe("network and advanced validation", () => {
  it("checks Wake-on-LAN only when it is enabled", () => {
    expect(issuesOf(sshValues({ wolEnabled: false, wolMac: "nope" }))).toEqual({});
    expect(issuesOf(sshValues({ wolEnabled: true, wolMac: "nope" }))).toEqual({
      wolMac: "invalidMac",
    });
    const mac = "aabbccddeeff";
    expect(issuesOf(sshValues({ wolEnabled: true, wolMac: mac, wolBroadcast: "x" }))).toEqual({
      wolBroadcast: "invalidIpv4",
    });
    expect(issuesOf(sshValues({ wolEnabled: true, wolMac: mac, wolPort: "0" }))).toEqual({
      wolPort: "invalidPort",
    });
    expect(issuesOf(sshValues({ wolEnabled: true, wolMac: mac, wolWaitTimeoutSecs: "5" }))).toEqual(
      {
        wolWaitTimeoutSecs: "waitRange",
      },
    );
  });

  it("checks the SSH timeouts when they are set", () => {
    expect(issuesOf(sshValues({ sshKeepaliveSecs: "4000" }))).toEqual({
      sshKeepaliveSecs: "keepaliveRange",
    });
    expect(issuesOf(sshValues({ sshConnectTimeoutSecs: "0" }))).toEqual({
      sshConnectTimeoutSecs: "timeoutRange",
    });
    expect(issuesOf(sshValues({ sshKeepaliveSecs: "", sshConnectTimeoutSecs: "" }))).toEqual({});
  });

  it("checks a fixed RDP resolution only", () => {
    expect(issuesOf(rdpValues({ rdpDisplayMode: "fixed", rdpWidth: "639" }))).toEqual({
      rdpWidth: "widthRange",
    });
    expect(issuesOf(rdpValues({ rdpDisplayMode: "fixed", rdpHeight: "479" }))).toEqual({
      rdpHeight: "heightRange",
    });
    expect(issuesOf(rdpValues({ rdpDisplayMode: "fit", rdpWidth: "1" }))).toEqual({});
  });

  it("refuses reserved, malformed or multi-line extra arguments", () => {
    expect(
      issuesOf(rdpValues({ rdpExtraArgs: ["/sound:sys:pulse", "+fonts", "-wallpaper"] })),
    ).toEqual({});
    expect(issuesOf(rdpValues({ rdpExtraArgs: ["/p:secret"] }))).toEqual({
      rdpExtraArgs: "reservedArg",
    });
    expect(issuesOf(rdpValues({ rdpExtraArgs: ["/V:evil"] }))).toEqual({
      rdpExtraArgs: "reservedArg",
    });
    expect(issuesOf(rdpValues({ rdpExtraArgs: ["noprefix"] }))).toEqual({
      rdpExtraArgs: "invalidArg",
    });
    expect(issuesOf(rdpValues({ rdpExtraArgs: ["/size:1\n/p:x"] }))).toEqual({
      rdpExtraArgs: "controlChars",
    });
    const many = Array.from({ length: 21 }, (_, index) => `+flag${index}`);
    expect(issuesOf(rdpValues({ rdpExtraArgs: many }))).toEqual({ rdpExtraArgs: "tooManyArgs" });
  });

  it("ignores the RDP fields of an SSH connection", () => {
    expect(
      issuesOf(sshValues({ rdpDisplayMode: "fixed", rdpWidth: "1", rdpExtraArgs: ["/p:x"] })),
    ).toEqual({});
  });
});
