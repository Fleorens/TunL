// "Sign in with a verification code?" — one masked field per question, echoing what the server asks (T21b).
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PromptKind } from "@/bindings/PromptKind";
import { Button } from "@/components/ui/button";
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

type InteractivePrompt = Extract<PromptKind, { kind: "keyboardInteractive" }>;

export function PromptInteractive({ id, prompt }: { id: string; prompt: InteractivePrompt }) {
  const { t } = useTranslation();

  const [values, setValues] = useState<string[]>(() => prompt.prompts.map(() => ""));
  const [open, setOpen] = useState(true);
  // Guard against answering (or cancelling) twice before the dialog unmounts.
  const answeredRef = useRef(false);
  const questions = prompt.prompts;

  const who = prompt.name || prompt.connectionName;

  function submit(answer: Parameters<typeof answerPrompt>[1]): void {
    if (answeredRef.current) return;
    answeredRef.current = true;
    void answerPrompt(id, answer);
    setOpen(false);
  }

  function submitResponses(): void {
    submit({ kind: "responses", values });
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
          <DialogTitle>{t("prompts.interactive.title", { name: who })}</DialogTitle>
        </DialogHeader>
        {prompt.instructions ? (
          <p className="text-sm text-muted-foreground">{prompt.instructions}</p>
        ) : null}
        <div className="flex flex-col gap-4">
          {questions.map((question, index) => (
            <div key={question.text} className="flex flex-col gap-2">
              <Label htmlFor={`prompt-q-${index}`}>{question.text.trim()}</Label>
              <Input
                id={`prompt-q-${index}`}
                type={question.echo ? "text" : "password"}
                autoComplete="off"
                value={values[index]}
                onChange={(event) =>
                  setValues((current) =>
                    current.map((value, i) => (i === index ? event.target.value : value)),
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitResponses();
                }}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => submit({ kind: "cancel" })}>
            {t("prompts.cancel")}
          </Button>
          <Button size="sm" onClick={submitResponses}>
            {t("prompts.continue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
