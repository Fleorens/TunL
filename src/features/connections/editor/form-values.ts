import type { AccentColor } from "@/bindings/AccentColor";
import type { AppError } from "@/bindings/AppError";
import type { ConnectionInput } from "@/bindings/ConnectionInput";
import type { ConnectionTemplates } from "@/bindings/ConnectionTemplates";
import type { Protocol } from "@/bindings/Protocol";
import type { ProtocolSettings } from "@/bindings/ProtocolSettings";
import type { RdpDisplay } from "@/bindings/RdpDisplay";
import type { RdpSettings } from "@/bindings/RdpSettings";
import type { SshAuth } from "@/bindings/SshAuth";
import type { SshSettings } from "@/bindings/SshSettings";
import type { WolConfig } from "@/bindings/WolConfig";
import { normalizeMac } from "./validation";

/**
 * The form only holds strings, booleans and string arrays (an `<input>` accepts no `null`, and a
 * conversion in the schema would break the typing). `toConnectionInput` does the real conversion.
 */
export interface ConnectionFormValues {
  protocol: Protocol;
  name: string;
  host: string;
  port: string;
  username: string;
  groupId: string;
  tags: string[];
  color: AccentColor | "";
  notes: string;
  sshAuthMethod: "password" | "key" | "agent";
  sshKeyPath: string;
  rdpDomain: string;
  jumpHostId: string;
  wolEnabled: boolean;
  wolMac: string;
  wolBroadcast: string;
  wolPort: string;
  wolWakeBeforeConnect: boolean;
  wolWaitTimeoutSecs: string;
  sshKeepaliveSecs: string;
  sshConnectTimeoutSecs: string;
  rdpDisplayMode: "fit" | "fullscreen" | "fixed";
  rdpWidth: string;
  rdpHeight: string;
  rdpMultimon: boolean;
  rdpDynamicResolution: boolean;
  rdpClipboard: boolean;
  rdpShareHome: boolean;
  rdpAudio: "local" | "remote" | "off";
  rdpCertPolicy: "prompt" | "tofu";
  rdpExtraArgs: string[];
}

/** A form field whose value is a string array, i.e. one `TagsInput` can edit (general tags or RDP extra arguments). */
export type ArrayFieldName = {
  [K in keyof ConnectionFormValues]: ConnectionFormValues[K] extends readonly unknown[] ? K : never;
}[keyof ConnectionFormValues];

/** A backend validation error attached to the form field it came from, or `null` (it goes to a toast). */
export type BackendFieldError = { field: keyof ConnectionFormValues; message: string };

/** The backend error path for each form field, so a validation error can be attached to the right one. */
const FIELD_BY_BACKEND_PATH: Record<string, keyof ConnectionFormValues> = {
  name: "name",
  host: "host",
  port: "port",
  username: "username",
  tags: "tags",
  notes: "notes",
  groupId: "groupId",
  "settings.auth.path": "sshKeyPath",
  "settings.domain": "rdpDomain",
  jumpHostId: "jumpHostId",
  "wol.mac": "wolMac",
  "wol.broadcast": "wolBroadcast",
  "wol.port": "wolPort",
  "wol.waitTimeoutSecs": "wolWaitTimeoutSecs",
  "settings.keepaliveSecs": "sshKeepaliveSecs",
  "settings.connectTimeoutSecs": "sshConnectTimeoutSecs",
  "settings.display": "rdpWidth",
  "settings.extraArgs": "rdpExtraArgs",
};

/** The SSH auth a connection uses: its own when it is SSH, otherwise the SSH template's default. */
function sshAuthOf(inputSettings: ProtocolSettings, sshTemplate: ProtocolSettings): SshAuth {
  if (inputSettings.protocol === "ssh") {
    return inputSettings.auth;
  }
  if (sshTemplate.protocol === "ssh") {
    return sshTemplate.auth;
  }
  return { method: "password" };
}

/** The domain a connection uses: its own when it is RDP, otherwise the RDP template's. */
function rdpDomainOf(
  inputSettings: ProtocolSettings,
  rdpTemplate: ProtocolSettings,
): string | null {
  if (inputSettings.protocol === "rdp") {
    return inputSettings.domain ?? null;
  }
  return rdpTemplate.protocol === "rdp" ? (rdpTemplate.domain ?? null) : null;
}

/** `null` becomes `""`, `port` becomes a string; the SSH fields come from the SSH template, the RDP fields from the RDP one. */
export function toFormValues(
  input: ConnectionInput,
  templates: ConnectionTemplates,
): ConnectionFormValues {
  const inputSettings = input.settings;
  const sshAuth = sshAuthOf(inputSettings, templates.ssh.settings);
  const rdpDomain = rdpDomainOf(inputSettings, templates.rdp.settings);
  const sshSettings = sshSettingsOf(inputSettings, templates.ssh.settings);
  const rdpSettings = rdpSettingsOf(inputSettings, templates.rdp.settings);
  const wol = input.wol ?? templates.wol;
  const display = rdpSettings.display;
  const protocol: Protocol = inputSettings.protocol;

  return {
    protocol,
    name: input.name,
    host: input.host,
    port: String(input.port),
    username: input.username ?? "",
    groupId: input.groupId ?? "",
    tags: [...input.tags],
    color: input.color ?? "",
    notes: input.notes ?? "",
    sshAuthMethod: sshAuth.method,
    sshKeyPath: sshAuth.method === "key" ? sshAuth.path : "",
    rdpDomain: rdpDomain ?? "",
    jumpHostId: input.jumpHostId ?? "",
    wolEnabled: input.wol !== null,
    wolMac: wol.mac,
    wolBroadcast: wol.broadcast,
    wolPort: String(wol.port),
    wolWakeBeforeConnect: wol.wakeBeforeConnect,
    wolWaitTimeoutSecs: String(wol.waitTimeoutSecs),
    sshKeepaliveSecs: sshSettings.keepaliveSecs === null ? "" : String(sshSettings.keepaliveSecs),
    sshConnectTimeoutSecs:
      sshSettings.connectTimeoutSecs === null ? "" : String(sshSettings.connectTimeoutSecs),
    rdpDisplayMode: display.mode,
    rdpWidth: display.mode === "fixed" ? String(display.width) : "1920",
    rdpHeight: display.mode === "fixed" ? String(display.height) : "1080",
    rdpMultimon: rdpSettings.multimon,
    rdpDynamicResolution: rdpSettings.dynamicResolution,
    rdpClipboard: rdpSettings.clipboard,
    rdpShareHome: rdpSettings.shareHome,
    rdpAudio: rdpSettings.audio,
    rdpCertPolicy: rdpSettings.certPolicy,
    rdpExtraArgs: [...rdpSettings.extraArgs],
  };
}

function authForSsh(method: "password" | "key" | "agent", sshKeyPath: string): SshAuth {
  return method === "key" ? { method: "key", path: sshKeyPath } : { method };
}

/**
 * SSH settings to spread: the connection's own when its protocol matches, otherwise the SSH
 * template's. Narrowed to the SSH variant so `auth` can be added on top.
 */
function sshSettingsOf(
  settings: ProtocolSettings,
  sshTemplate: ProtocolSettings,
): {
  protocol: "ssh";
} & SshSettings {
  if (settings.protocol === "ssh") {
    return settings;
  }
  if (sshTemplate.protocol === "ssh") {
    return sshTemplate;
  }
  return {
    protocol: "ssh",
    auth: { method: "password" },
    keepaliveSecs: null,
    connectTimeoutSecs: null,
  };
}

/**
 * RDP settings to spread: the connection's own when its protocol matches, otherwise the RDP
 * template's. Narrowed to the RDP variant so `domain` can be added on top.
 */
function rdpSettingsOf(
  settings: ProtocolSettings,
  rdpTemplate: ProtocolSettings,
): {
  protocol: "rdp";
} & RdpSettings {
  if (settings.protocol === "rdp") {
    return settings;
  }
  if (rdpTemplate.protocol === "rdp") {
    return rdpTemplate;
  }
  return {
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
  };
}

/**
 * Converts the form values (strings only) into a `ConnectionInput` for the backend.
 *
 * `base` is the edited connection (`toInput(connection)`) or the template. Only `favorite` is still taken from it:
 * the form edits the rest, including `jumpHostId` and `wol`.
 */
export function toConnectionInput(
  values: ConnectionFormValues,
  base: ConnectionInput,
  _templates: ConnectionTemplates,
): ConnectionInput {
  const name = values.name.trim();
  const host = values.host.trim();
  const username = values.username.trim();
  const sshKeyPath = values.sshKeyPath.trim();
  const rdpDomain = values.rdpDomain.trim();
  const groupId = values.groupId.trim();
  const keepalive = values.sshKeepaliveSecs.trim();
  const timeout = values.sshConnectTimeoutSecs.trim();

  const sshSettings: { protocol: "ssh" } & SshSettings = {
    protocol: "ssh",
    auth: authForSsh(values.sshAuthMethod, sshKeyPath),
    keepaliveSecs: keepalive === "" ? null : Number(keepalive),
    connectTimeoutSecs: timeout === "" ? null : Number(timeout),
  };

  const rdpDisplayMode = values.rdpDisplayMode;
  const display: RdpDisplay =
    rdpDisplayMode === "fixed"
      ? { mode: "fixed", width: Number(values.rdpWidth), height: Number(values.rdpHeight) }
      : { mode: rdpDisplayMode };
  const rdpSettings: { protocol: "rdp" } & RdpSettings = {
    protocol: "rdp",
    domain: rdpDomain === "" ? null : rdpDomain,
    display,
    multimon: values.rdpMultimon,
    dynamicResolution: values.rdpDynamicResolution,
    clipboard: values.rdpClipboard,
    audio: values.rdpAudio,
    shareHome: values.rdpShareHome,
    certPolicy: values.rdpCertPolicy,
    extraArgs: [...values.rdpExtraArgs],
  };

  const settings: ProtocolSettings = values.protocol === "ssh" ? sshSettings : rdpSettings;

  const jumpHostId = values.jumpHostId === "" ? null : values.jumpHostId;
  const wol = values.wolEnabled ? wolConfigFrom(values) : null;

  return {
    name,
    host,
    port: Number(values.port),
    username: username === "" ? null : username,
    groupId: groupId === "" ? null : groupId,
    tags: [...values.tags],
    favorite: base.favorite,
    color: values.color === "" ? null : values.color,
    notes: values.notes.trim() === "" ? null : values.notes,
    jumpHostId,
    wol,
    settings,
  };
}

/** The Wake-on-LAN config from the form: the MAC is normalized, falling back to the trimmed input. */
function wolConfigFrom(values: ConnectionFormValues): WolConfig {
  return {
    mac: normalizeMac(values.wolMac) ?? values.wolMac.trim(),
    broadcast: values.wolBroadcast.trim(),
    port: Number(values.wolPort),
    wakeBeforeConnect: values.wolWakeBeforeConnect,
    waitTimeoutSecs: Number(values.wolWaitTimeoutSecs),
  };
}

/** Maps a backend validation error to its form field, or `null` so it falls back to a toast. */
export function backendFieldError(error: AppError): BackendFieldError | null {
  if (error.kind !== "validation") return null;

  const separator = error.message.indexOf(": ");
  if (separator === -1) return null;

  const field = FIELD_BY_BACKEND_PATH[error.message.slice(0, separator)];
  if (field === undefined) return null;

  return { field, message: error.message.slice(separator + 2) };
}

export { connectionFormSchema } from "./schema";
