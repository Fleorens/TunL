// The secrets the editor is editing, per kind, without touching the keyring (S2).
// Kept out of react-hook-form: a secret is written, tested, forgotten — never read back.
import type { SecretKind } from "@/bindings/SecretKind";
import type { ConnectionFormValues } from "./form-values";
import type { ValidationCode } from "./validation";
import { hasControlChars } from "./validation";

/** What the editor should do with one kind of secret when saving. */
export type SecretDraft =
  | { action: "keep" }
  | { action: "set"; value: string }
  | { action: "forget" };
/** The drafts for both kinds, always present. */
export type SecretDrafts = Readonly<Record<SecretKind, SecretDraft>>;

/** A secret to apply to the keyring after a save: write a new value, or forget one. */
export type SecretOperation =
  | { type: "set"; kind: SecretKind; value: string }
  | { type: "delete"; kind: SecretKind };

/** Nothing changed: both kinds are kept as they are in the keyring. */
export const UNCHANGED_SECRETS: SecretDrafts = {
  password: { action: "keep" },
  passphrase: { action: "keep" },
};

/** Return a new drafts object with `kind` set to `draft`, the other kind untouched. */
export function withDraft(
  drafts: SecretDrafts,
  kind: SecretKind,
  draft: SecretDraft,
): SecretDrafts {
  return { ...drafts, [kind]: draft };
}

/** Type a value: empty keeps the keyring as is, anything else (even blank spaces) sets it. */
export function typedSecret(value: string): SecretDraft {
  return value === "" ? { action: "keep" } : { action: "set", value };
}

/** Dirty as soon as one kind is not kept. */
export function secretsDirty(drafts: SecretDrafts): boolean {
  return drafts.password.action !== "keep" || drafts.passphrase.action !== "keep";
}

/** The validation error a value would produce on the backend, or `null`. */
export function secretError(value: string): ValidationCode | null {
  if (hasControlChars(value)) return "controlChars";
  if (value.length > 1024) return "tooLong";
  return null;
}

/** Valid when every "set" draft would pass `secretError`. */
export function secretsValid(drafts: SecretDrafts): boolean {
  return Object.values(drafts).every(
    (draft) => draft.action !== "set" || !secretError(draft.value),
  );
}

/** The kinds that matter for these settings: an agent needs no secret at all. */
export function secretKindsFor(
  values: Pick<ConnectionFormValues, "protocol" | "sshAuthMethod">,
): SecretKind[] {
  if (values.protocol === "rdp") return ["password"];
  switch (values.sshAuthMethod) {
    case "password":
      return ["password"];
    case "key":
      return ["passphrase"];
    default:
      return [];
  }
}

/** The operations to run after a save, for `kinds` only, in the given order. "keep" gives nothing. */
export function secretOperations(
  drafts: SecretDrafts,
  kinds: readonly SecretKind[],
): SecretOperation[] {
  const operations: SecretOperation[] = [];
  for (const kind of kinds) {
    const draft = drafts[kind];
    if (draft.action === "set") operations.push({ type: "set", kind, value: draft.value });
    else if (draft.action === "forget") operations.push({ type: "delete", kind });
  }
  return operations;
}
