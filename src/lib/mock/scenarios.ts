// Per-connection mock scenarios (T21b): the four connections that pose a prompt while connecting.
// They emit prompts through `askMockPrompt` and read the retained state from `prompts.ts`. A scenario
// returns an `AppError` to fail the attempt, or `null` to let the connection continue (docs/06 §S6).
import type { AppError } from "@/bindings/AppError";
import {
  askMockPrompt,
  hasStoredPassword,
  isHostKeyLearned,
  isHostKeyRemoved,
  markHostKeyLearned,
  rememberPassword,
} from "./prompts";

const KIOSK_HOST = "172.16.0.40";
const OLD_FINGERPRINT = "SHA256:oldKioskHostKeyFingerprintValue";
const NEW_FINGERPRINT = "SHA256:newKioskHostKeyFingerprintValue";
const DB_FINGERPRINT = "SHA256:dbProdFixedHostKeyFingerprintValue";

function rejected(): AppError {
  return { kind: "hostKeyRejected", message: "host key rejected", detail: null };
}
function cancelled(): AppError {
  return { kind: "cancelled", message: "authentication cancelled", detail: null };
}
function changed(): AppError {
  return {
    kind: "hostKeyChanged",
    message: "host key changed",
    detail: {
      type: "hostKeyChanged",
      host: KIOSK_HOST,
      port: 22,
      keyType: "ssh-ed25519",
      fingerprint: NEW_FINGERPRINT,
      knownFingerprint: OLD_FINGERPRINT,
      knownHostsPath: "~/.config/io.github.fleorens.TunL/known_hosts",
      line: 3,
      removable: true,
    },
  };
}

interface ScenarioContext {
  sessionId: string;
  host: string;
  port: number;
}

// A host-key step: first connect asks to trust, a learned key connects, a rejected one fails.
async function hostKeyStep(ctx: ScenarioContext): Promise<AppError | null> {
  const { sessionId, host, port } = ctx;
  if (isHostKeyLearned(host, port)) return null;
  const answer = await askMockPrompt(sessionId, {
    kind: "hostKeyUnknown",
    host,
    port,
    keyType: "ssh-ed25519",
    fingerprint: DB_FINGERPRINT,
  });
  if (answer.kind === "accept") {
    markHostKeyLearned(host, port);
    return null;
  }
  return rejected();
}

// A password step: ask once, ask again on a wrong value, connect and remember on a good one.
async function passwordStep(ctx: ScenarioContext): Promise<AppError | null> {
  const { sessionId } = ctx;
  if (hasStoredPassword("router")) return null;
  let answer = await askMockPrompt(sessionId, {
    kind: "password",
    connectionName: "router",
    username: "root",
    host: "192.168.1.1",
    canSave: true,
    retry: false,
  });
  while (answer.kind === "secret" && answer.value === "wrong") {
    answer = await askMockPrompt(sessionId, {
      kind: "password",
      connectionName: "router",
      username: "root",
      host: "192.168.1.1",
      canSave: true,
      retry: true,
    });
  }
  if (answer.kind === "secret") {
    if (answer.save) rememberPassword("router");
    return null;
  }
  return cancelled();
}

// A keyboard-interactive (2FA) step: every question answered connects; cancel fails.
async function interactiveStep(ctx: ScenarioContext): Promise<AppError | null> {
  const { sessionId } = ctx;
  const answer = await askMockPrompt(sessionId, {
    kind: "keyboardInteractive",
    connectionName: "media-server",
    name: "",
    instructions: "Two-factor authentication",
    prompts: [
      { text: "Password:", echo: false },
      { text: "Verification code:", echo: true },
    ],
  });
  if (answer.kind === "responses") return null;
  return cancelled();
}

// The changed-host-key refusal: blocked until the old key is removed, then a first connect.
async function changedKeyStep(ctx: ScenarioContext): Promise<AppError | null> {
  if (!isHostKeyRemoved(ctx.host, ctx.port)) return changed();
  return hostKeyStep(ctx);
}

type ScenarioStep = "hostKey" | "auth";

interface Scenario {
  step: ScenarioStep;
  run: (ctx: ScenarioContext) => Promise<AppError | null>;
}

const SCENARIOS: Record<string, Scenario> = {
  "db-prod": { step: "hostKey", run: hostKeyStep },
  router: { step: "auth", run: passwordStep },
  "media-server": { step: "auth", run: interactiveStep },
  "kiosk-01": { step: "hostKey", run: changedKeyStep },
};

/** The scenario for a connection name, or `null` when this connection poses no prompt. */
export function getScenario(name: string): Scenario | null {
  return SCENARIOS[name] ?? null;
}
