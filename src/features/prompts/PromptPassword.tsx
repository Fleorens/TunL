// "What is the password / passphrase?" — masked field, show-hide toggle, remember in the keyring (T21b).
// The secret lives only in this dialogue's state, cleared on close: never a store, a log, or localStorage (S1, S2).
import { Eye, EyeOff } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PromptKind } from "@/bindings/PromptKind";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { answerPrompt } from "./answer";

type SecretPrompt = Extract<PromptKind, { kind: "password" | "passphrase" }>;

export function PromptPassword({ id, prompt }: { id: string; prompt: SecretPrompt }) {
  const { t } = useTranslation();
  const isPassphrase = prompt.kind === "passphrase";

  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [save, setSave] = useState(false);
  const [open, setOpen] = useState(true);
  // Guard against answering (or cancelling) twice before the dialog unmounts.
  const answeredRef = useRef(false);

  const label = t(isPassphrase ? "prompts.passphrase.label" : "prompts.password.label");
  const toggleKey =
    `prompts.${isPassphrase ? "passphrase" : "password"}.${show ? "hide" : "show"}` as const;
  const toggleLabel = t(toggleKey);
  const title = isPassphrase
    ? t("prompts.passphrase.title", { keyPath: prompt.keyPath })
    : t("prompts.password.title", { username: prompt.username, host: prompt.host });
  const retryText = t(isPassphrase ? "prompts.passphrase.retry" : "prompts.password.retry");
  const saveLabel = t("prompts.remember");
  const connectLabel = t("prompts.connect");
  const cancelLabel = t("prompts.cancel");

  function submit(answer: Parameters<typeof answerPrompt>[1]): void {
    if (answeredRef.current) return;
    answeredRef.current = true;
    void answerPrompt(id, answer);
    setOpen(false);
  }

  function submitSecret(): void {
    if (value === "") return;
    submit({ kind: "secret", value, save });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (answeredRef.current) return;
        if (next) {
          setOpen(next);
          return;
        }
        submit({ kind: "cancel" });
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {prompt.retry && <p className="text-sm text-destructive">{retryText}</p>}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="prompt-secret">{label}</Label>
            <div className="flex flex-1 items-center gap-2">
              <Input
                id="prompt-secret"
                type={show ? "text" : "password"}
                autoComplete="off"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitSecret();
                }}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShow((current) => !current)}
                aria-label={toggleLabel}
              >
                {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              </Button>
            </div>
          </div>
          {prompt.canSave && (
            <div className="flex items-center gap-2">
              <Label htmlFor="prompt-save" className="shrink-0 text-sm">
                {saveLabel}
              </Label>
              <Checkbox
                id="prompt-save"
                checked={save}
                onCheckedChange={(next) => setSave(next === true)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => submit({ kind: "cancel" })}>
            {cancelLabel}
          </Button>
          <Button size="sm" onClick={submitSecret} disabled={value === ""}>
            {connectLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
