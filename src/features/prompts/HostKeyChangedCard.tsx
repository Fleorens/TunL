// The one refusal TunL makes: a host key that differs from the recorded one (docs/06 §S6).
// The old key is removed only after typing the host to confirm; otherwise the user removes it by hand.
import { ShieldAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ErrorDetail } from "@/bindings/ErrorDetail";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { i18n } from "@/i18n";
import { notifyError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";

interface HostKeyChangedCardProps {
  /** The tab's name, in the title. */
  name: string;
  /** The `hostKeyChanged` detail from the error. */
  detail: Extract<ErrorDetail, { type: "hostKeyChanged" }>;
  onReconnect: () => void;
  onClose: () => void;
}

export function HostKeyChangedCard({
  name,
  detail,
  onReconnect,
  onClose,
}: HostKeyChangedCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState("");

  const removable = detail.removable;
  const command =
    detail.port === 22
      ? `ssh-keygen -R ${detail.host}`
      : `ssh-keygen -R "[${detail.host}]:${detail.port}"`;

  async function removeKey(): Promise<void> {
    try {
      await ipc.knownHostRemove(detail.host, detail.port);
      toast(i18n.t("hostKeyChanged.removed"));
      onReconnect();
    } catch (error) {
      notifyError(error);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        role="alert"
        className="absolute inset-0 flex h-full w-full items-center justify-center bg-background/60"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
      >
        <div className="flex w-80 max-w-[calc(100%-2rem)] flex-col rounded-lg glass shadow-elevated p-5">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-destructive" aria-hidden />
            <p className="text-sm font-medium">{t("hostKeyChanged.title", { name })}</p>
          </div>
          <p className="mt-2 text-sm">{t("hostKeyChanged.explanation")}</p>
          <dl className="mt-3 flex flex-col gap-1.5 break-all font-mono text-xs">
            <dt className="text-muted-foreground">{t("hostKeyChanged.knownKey")}</dt>
            <dd>{detail.knownFingerprint}</dd>
            <dt className="text-muted-foreground">{t("hostKeyChanged.presentedKey")}</dt>
            <dd>{detail.fingerprint}</dd>
          </dl>
          {removable ? (
            <Button className="mt-3 self-start" onClick={() => setOpen(true)}>
              {t("hostKeyChanged.remove")}
            </Button>
          ) : (
            <p className="mt-3 flex flex-wrap items-center gap-1 text-sm">
              <span className="text-muted-foreground">
                {t("hostKeyChanged.notRemovable", { path: detail.knownHostsPath })}
              </span>
              <span className="font-mono select-all">{command}</span>
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              {t("hostKeyChanged.close")}
            </Button>
          </div>

          {removable && (
            <AlertDialog open={open} onOpenChange={setOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("hostKeyChanged.removeTitle", { host: detail.host })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("hostKeyChanged.confirm", { host: detail.host })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Label htmlFor="remove-host-key" className="sr-only">
                  {t("hostKeyChanged.confirm", { host: detail.host })}
                </Label>
                <Input
                  id="remove-host-key"
                  value={confirmed}
                  onChange={(event) => setConfirmed(event.target.value)}
                  spellCheck={false}
                />
                <AlertDialogFooter>
                  <AlertDialogCancel
                    onClick={() => {
                      setOpen(false);
                      setConfirmed("");
                    }}
                  >
                    {t("prompts.cancel")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={confirmed !== detail.host}
                    onClick={() => {
                      setOpen(false);
                      setConfirmed("");
                      void removeKey();
                    }}
                  >
                    {t("hostKeyChanged.removeKey")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
