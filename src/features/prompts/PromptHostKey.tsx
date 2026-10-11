// "Do you trust this host key?" — the first-connection prompt (T21b). Refusal is the default (docs/06 §S6).
import { ShieldQuestion } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PromptKind } from "@/bindings/PromptKind";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { answerPrompt } from "./answer";

export function PromptHostKey({
  id,
  prompt,
}: {
  id: string;
  prompt: Extract<PromptKind, { kind: "hostKeyUnknown" }>;
}) {
  const { t } = useTranslation();

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <ShieldQuestion className="size-5" aria-hidden />
            <AlertDialogTitle>
              {t("prompts.hostKey.title", { host: prompt.host, port: prompt.port })}
            </AlertDialogTitle>
          </div>
          <div className="flex flex-col gap-3">
            <dl className="flex flex-col gap-1.5">
              <dt className="text-sm text-muted-foreground">{t("prompts.hostKey.keyType")}</dt>
              <dd className="font-mono">{prompt.keyType}</dd>
              <dt className="text-sm text-muted-foreground">{t("prompts.hostKey.fingerprint")}</dt>
              <dd className="break-all font-mono select-all">{prompt.fingerprint}</dd>
            </dl>
            <p className="text-sm">{t("prompts.hostKey.check")}</p>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answerPrompt(id, { kind: "reject" })}>
            {t("prompts.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => answerPrompt(id, { kind: "accept" })}>
            {t("prompts.hostKey.trust")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
