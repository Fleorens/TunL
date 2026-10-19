// "Permissions of …": a 3 × 3 grid of boxes and an octal field that stay in agreement, applied in one chmod.
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
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
import { hasBit, parseOctal, toggleBit, toOctal, WHAT, WHO } from "./permissions";

interface PermissionsDialogProps {
  entry: RemoteEntry;
  onApply: (mode: number) => void;
  onCancel: () => void;
}

export function PermissionsDialog({ entry, onApply, onCancel }: PermissionsDialogProps) {
  const { t } = useTranslation();
  const initial = (entry.permissions ?? 0) & 0o7777;
  // The last valid mode drives the boxes; the field keeps what is typed, valid or not.
  const [mode, setMode] = useState(initial);
  const [octal, setOctal] = useState(toOctal(initial));
  const parsed = parseOctal(octal);

  const onOctal = (text: string): void => {
    setOctal(text);
    const next = parseOctal(text);
    if (next !== null) setMode(next);
  };

  const onToggle = (next: number): void => {
    setMode(next);
    setOctal(toOctal(next));
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sftp.permissions.title", { name: entry.name })}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,4.5rem)] items-center gap-y-2">
          <span />
          {WHAT.map((what) => (
            <span key={what} className="text-center text-xs font-medium text-muted-foreground">
              {t(`sftp.permissions.${what}`)}
            </span>
          ))}
          {WHO.map((who) => (
            <Fragment key={who}>
              <span className="text-sm">{t(`sftp.permissions.${who}`)}</span>
              {WHAT.map((what) => (
                <div key={what} className="flex justify-center">
                  <Checkbox
                    aria-label={t("sftp.permissions.box", {
                      who: t(`sftp.permissions.${who}`),
                      what: t(`sftp.permissions.${what}`),
                    })}
                    checked={hasBit(mode, who, what)}
                    onCheckedChange={() => onToggle(toggleBit(mode, who, what))}
                  />
                </div>
              ))}
            </Fragment>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="sftp-octal">{t("sftp.permissions.octal")}</Label>
          <Input
            id="sftp-octal"
            autoComplete="off"
            className="w-24 font-mono"
            value={octal}
            aria-invalid={parsed === null}
            onChange={(event) => onOctal(event.target.value)}
          />
          {parsed === null && (
            <p className="text-sm text-destructive">{t("sftp.permissions.invalid")}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={parsed === null} onClick={() => onApply(mode)}>
            {t("sftp.permissions.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
