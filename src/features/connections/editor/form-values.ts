import { z } from "zod";
import type { AccentColor } from "@/bindings/AccentColor";
import type { AppError } from "@/bindings/AppError";
import type { ConnectionInput } from "@/bindings/ConnectionInput";
import type { ConnectionTemplates } from "@/bindings/ConnectionTemplates";
import type { Protocol } from "@/bindings/Protocol";
import type { ProtocolSettings } from "@/bindings/ProtocolSettings";
import type { RdpSettings } from "@/bindings/RdpSettings";
import type { SshAuth } from "@/bindings/SshAuth";
import type { SshSettings } from "@/bindings/SshSettings";
import { hasControlChars, isValidHost, isValidPath, TAG_PATTERN } from "./validation";

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
}

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
 * `base` is the edited connection (`toInput(connection)`) or the template. `favorite`, `jumpHostId`
 * and `wol` are taken from it because the form does not edit them yet.
 */
export function toConnectionInput(
  values: ConnectionFormValues,
  base: ConnectionInput,
  templates: ConnectionTemplates,
): ConnectionInput {
  const name = values.name.trim();
  const host = values.host.trim();
  const username = values.username.trim();
  const sshKeyPath = values.sshKeyPath.trim();
  const rdpDomain = values.rdpDomain.trim();
  const groupId = values.groupId.trim();

  const baseSettings = base.settings;

  const sshStart =
    values.protocol === baseSettings.protocol && baseSettings.protocol === "ssh"
      ? baseSettings
      : sshSettingsOf(baseSettings, templates.ssh.settings);
  const rdpStart =
    values.protocol === baseSettings.protocol && baseSettings.protocol === "rdp"
      ? baseSettings
      : rdpSettingsOf(baseSettings, templates.rdp.settings);

  const settings: ProtocolSettings =
    values.protocol === "ssh"
      ? { ...sshStart, auth: authForSsh(values.sshAuthMethod, sshKeyPath) }
      : { ...rdpStart, domain: rdpDomain === "" ? null : rdpDomain };

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
    jumpHostId: base.jumpHostId,
    wol: base.wol,
    settings,
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

/** True when `port` is a whole number between 1 and 65535. Empty fails too (single `invalidPort` code). */
function isValidPort(port: string): boolean {
  if (!/^\d+$/.test(port)) return false;
  const number = Number(port);
  return number >= 1 && number <= 65535;
}

/**
 * The form schema. Rules reproduced from the Rust side (docs/05-modele-donnees.md §6).
 *
 * - Every message is a code from `VALIDATION_CODES`, shown by `FieldError` via `t("validation.<code>")`.
 * - An empty field yields only `required`; the next check ignores the empty string. The port is the
 *   exception: it has a single `invalidPort` code, even when empty.
 * - `sshKeyPath` is only required when the protocol is SSH and the method is a key (see `superRefine`).
 */
export const connectionFormSchema = z
  .object({
    protocol: z.enum(["ssh", "rdp"]),
    name: z
      .string()
      .trim()
      .min(1, { error: "required", abort: true })
      .max(80, { error: "tooLong" })
      .refine((value) => !hasControlChars(value), { error: "controlChars" }),
    host: z
      .string()
      .trim()
      .min(1, { error: "required", abort: true })
      .refine(isValidHost, { error: "invalidHost" }),
    port: z.string().trim().refine(isValidPort, { error: "invalidPort" }),
    username: z
      .string()
      .trim()
      .refine((value) => !hasControlChars(value), { error: "controlChars" }),
    groupId: z.string(),
    tags: z
      .array(z.string().refine((value) => TAG_PATTERN.test(value), { error: "invalidTag" }))
      .max(10, { error: "tooManyTags" }),
    color: z.enum([
      "",
      "slate",
      "red",
      "orange",
      "amber",
      "green",
      "teal",
      "cyan",
      "blue",
      "violet",
      "pink",
    ]),
    notes: z.string(),
    sshAuthMethod: z.enum(["password", "key", "agent"]),
    sshKeyPath: z.string(),
    rdpDomain: z.string().refine((value) => !hasControlChars(value), { error: "controlChars" }),
  })
  .superRefine((value, ctx) => {
    if (value.protocol === "ssh" && value.sshAuthMethod === "key") {
      if (value.sshKeyPath.trim() === "") {
        ctx.addIssue({ code: "custom", message: "required", path: ["sshKeyPath"] });
      } else if (!isValidPath(value.sshKeyPath)) {
        ctx.addIssue({ code: "custom", message: "invalidPath", path: ["sshKeyPath"] });
      }
    }
  });
