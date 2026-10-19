// "New folder": one name, checked as it is typed (the same rule as the server), created on Enter or Create.
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { isValidName } from "./sftp-model";

interface NewFolderDialogProps {
  onCreate: (name: string) => void;
  onCancel: () => void;
}

export function NewFolderDialog({ onCreate, onCancel }: NewFolderDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const valid = isValidName(name);
  // An empty field is not an error yet: the message waits for a typed name.
  const showError = name !== "" && !valid;

  const create = (): void => {
    if (valid) onCreate(name);
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
          <DialogTitle>{t("sftp.newFolder.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="sftp-new-folder">{t("sftp.newFolder.name")}</Label>
          <Input
            id="sftp-new-folder"
            autoFocus
            autoComplete="off"
            value={name}
            aria-invalid={showError}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") create();
            }}
          />
          {showError && <p className="text-sm text-destructive">{t("sftp.invalidName")}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={!valid} onClick={create}>
            {t("sftp.newFolder.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
