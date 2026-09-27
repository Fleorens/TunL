import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AccentColor } from "@/bindings/AccentColor";
import type { AppError } from "@/bindings/AppError";
import type { Group } from "@/bindings/Group";
import type { GroupInput } from "@/bindings/GroupInput";
import { ColorPicker } from "@/components/ColorPicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Result } from "@/lib/result";

interface GroupDialogProps {
  open: boolean;
  mode: "create" | "rename";
  /** The group being renamed, or `null` when creating a new group. */
  initialId: string | null;
  initialName: string;
  initialColor: AccentColor | null;
  /** Commits the form to the store (createGroup or updateGroup). */
  onCommit: (input: GroupInput, id: string | null) => Promise<Result<Group>>;
  onClose: () => void;
}

export function GroupDialog({
  open,
  mode,
  initialId,
  initialName,
  initialColor,
  onCommit,
  onClose,
}: GroupDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState<AccentColor | null>(initialColor);
  const [error, setError] = useState<AppError | null>(null);

  // Reset the form every time the dialog opens, so a previous commit never leaks in.
  useEffect(() => {
    if (open) {
      setName(initialName);
      setColor(initialColor);
      setError(null);
    }
  }, [open, initialName, initialColor]);

  const commit = async () => {
    const result = await onCommit({ name, color }, initialId);
    if (result.ok) {
      onClose();
    } else {
      setError(result.error);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? t("groupDialog.createTitle") : t("groupDialog.renameTitle")}
          </DialogTitle>
          <DialogDescription>
            {mode === "create" ? t("groupDialog.create") : t("groupDialog.renameTitle")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="group-name">{t("groupDialog.name")}</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={error !== null}
            />
            {error && <p className="text-sm text-destructive">{error.message}</p>}
          </div>
          <div className="grid gap-2">
            <Label>{t("groupDialog.color")}</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={commit}>
            {mode === "create" ? t("groupDialog.create") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
