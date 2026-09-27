import { z } from "zod";
import {
  hasControlChars,
  isValidHost,
  isValidIpv4,
  isValidPath,
  isValidPort,
  isWholeInRange,
  normalizeMac,
  rdpArgError,
  TAG_PATTERN,
} from "./validation";

/**
 * The form schema. Rules reproduced from the Rust side (docs/05-modele-donnees.md §6).
 *
 * - Every message is a code from `VALIDATION_CODES`, shown by `FieldError` via `t("validation.<code>")`.
 * - An empty field yields only `required`; the next check ignores the empty string. The port is the
 *   exception: it has a single `invalidPort` code, even when empty.
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
    jumpHostId: z.string(),
    wolEnabled: z.boolean(),
    wolMac: z.string(),
    wolBroadcast: z.string(),
    wolPort: z.string(),
    wolWakeBeforeConnect: z.boolean(),
    wolWaitTimeoutSecs: z.string(),
    sshKeepaliveSecs: z.string(),
    sshConnectTimeoutSecs: z.string(),
    rdpDisplayMode: z.enum(["fit", "fullscreen", "fixed"]),
    rdpWidth: z.string(),
    rdpHeight: z.string(),
    rdpMultimon: z.boolean(),
    rdpDynamicResolution: z.boolean(),
    rdpClipboard: z.boolean(),
    rdpShareHome: z.boolean(),
    rdpAudio: z.enum(["local", "remote", "off"]),
    rdpCertPolicy: z.enum(["prompt", "tofu"]),
    rdpExtraArgs: z.array(z.string()),
  })
  .superRefine((value, ctx) => {
    if (value.protocol === "ssh" && value.sshAuthMethod === "key") {
      if (value.sshKeyPath.trim() === "") {
        ctx.addIssue({ code: "custom", message: "required", path: ["sshKeyPath"] });
      } else if (!isValidPath(value.sshKeyPath)) {
        ctx.addIssue({ code: "custom", message: "invalidPath", path: ["sshKeyPath"] });
      }
    }

    // Wake-on-LAN is validated only when enabled, for any protocol.
    if (value.wolEnabled) {
      if (normalizeMac(value.wolMac) === null) {
        ctx.addIssue({ code: "custom", message: "invalidMac", path: ["wolMac"] });
      }
      if (!isValidIpv4(value.wolBroadcast)) {
        ctx.addIssue({ code: "custom", message: "invalidIpv4", path: ["wolBroadcast"] });
      }
      if (!isValidPort(value.wolPort)) {
        ctx.addIssue({ code: "custom", message: "invalidPort", path: ["wolPort"] });
      }
      if (!isWholeInRange(value.wolWaitTimeoutSecs, 10, 600)) {
        ctx.addIssue({ code: "custom", message: "waitRange", path: ["wolWaitTimeoutSecs"] });
      }
    }

    // The SSH timeouts defer to the global setting when empty; checked only for SSH connections.
    if (value.protocol === "ssh") {
      if (
        value.sshKeepaliveSecs.trim() !== "" &&
        !isWholeInRange(value.sshKeepaliveSecs, 0, 3600)
      ) {
        ctx.addIssue({ code: "custom", message: "keepaliveRange", path: ["sshKeepaliveSecs"] });
      }
      if (
        value.sshConnectTimeoutSecs.trim() !== "" &&
        !isWholeInRange(value.sshConnectTimeoutSecs, 1, 120)
      ) {
        ctx.addIssue({ code: "custom", message: "timeoutRange", path: ["sshConnectTimeoutSecs"] });
      }
    }

    // The RDP display and extra arguments are checked only for RDP connections.
    if (value.protocol === "rdp") {
      if (value.rdpDisplayMode === "fixed") {
        if (!isWholeInRange(value.rdpWidth, 640, 8192)) {
          ctx.addIssue({ code: "custom", message: "widthRange", path: ["rdpWidth"] });
        }
        if (!isWholeInRange(value.rdpHeight, 480, 8192)) {
          ctx.addIssue({ code: "custom", message: "heightRange", path: ["rdpHeight"] });
        }
      }
      if (value.rdpExtraArgs.length > 20) {
        ctx.addIssue({ code: "custom", message: "tooManyArgs", path: ["rdpExtraArgs"] });
      }
      for (const arg of value.rdpExtraArgs) {
        const code = rdpArgError(arg);
        if (code !== null) {
          ctx.addIssue({ code: "custom", message: code, path: ["rdpExtraArgs"] });
        }
      }
    }
  });
