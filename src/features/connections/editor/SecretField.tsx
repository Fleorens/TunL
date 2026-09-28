// One secret field (SSH passphrase, SSH password, or RDP password), backed by the keyring (S2).
// The value is never read back: the field shows a presence test (`useSecretStatus`) and the draft
// the editor holds, and writes it only when the connection is saved.

import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SecretKind } from "@/bindings/SecretKind";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { FieldError } from "./FieldError";
import { secretError, typedSecret } from "./secret-drafts";
import { useSecretEditor } from "./secrets-context";
import { useSecretStatus } from "./use-secret-status";

/** The i18n label key for each kind (so the translated key stays a known key). */
const LABEL_KEY_BY_KIND: Record<SecretKind, "passwordLabel" | "passphraseLabel"> = {
  password: "passwordLabel",
  passphrase: "passphraseLabel",
};

export function SecretField({ kind }: { kind: SecretKind }) {
  const { t } = useTranslation();
  const { connectionId, drafts, setDraft } = useSecretEditor();
  const status = useSecretStatus(connectionId, kind);
  const draft = drafts[kind];
  // While `saved`, replacing the secret opens the field; `none` opens it directly.
  const [editing, setEditing] = useState(false);

  const value = draft.action === "set" ? draft.value : "";
  const errorMessage = secretError(value) ?? undefined;

  if (status === "loading") {
    return <Skeleton className="h-10 w-full" />;
  }

  // The keyring is down: explain, no field to edit.
  if (status === "unavailable") {
    return <p className="text-sm text-muted-foreground">{t("editor.secret.unavailable")}</p>;
  }

  // A forget is scheduled: say so, with a way to undo it.
  if (draft.action === "forget") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-2.5">
        <span className="truncate text-sm text-muted-foreground">
          {t("editor.secret.willForget")}
        </span>
        <Button variant="outline" size="sm" onClick={() => setDraft(kind, { action: "keep" })}>
          {t("editor.secret.undo")}
        </Button>
      </div>
    );
  }

  // Edit the value: nothing stored yet, or the user asked to replace a stored one.
  if (status === "none" || editing) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`secret-${kind}`}>{t(`editor.secret.${LABEL_KEY_BY_KIND[kind]}`)}</Label>
        <Input
          id={`secret-${kind}`}
          type="password"
          autoComplete="off"
          value={value}
          onChange={(event) => setDraft(kind, typedSecret(event.target.value))}
        />
        <p className="text-sm text-muted-foreground">{t("editor.secret.hint")}</p>
        <FieldError message={errorMessage} />
        {status === "saved" && (
          <Button
            variant="outline"
            size="sm"
            className="self-end"
            onClick={() => {
              setEditing(false);
              setDraft(kind, { action: "keep" });
            }}
          >
            {t("editor.secret.cancel")}
          </Button>
        )}
      </div>
    );
  }

  // A secret is stored and untouched: show it, offer to replace or forget.
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Check className="size-4 shrink-0 text-status-online" aria-hidden="true" />
        <span className="truncate text-sm font-medium">{t("editor.secret.saved")}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          {t("editor.secret.replace")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDraft(kind, { action: "forget" })}>
          {t("editor.secret.forget")}
        </Button>
      </div>
    </div>
  );
}
