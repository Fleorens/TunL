import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ConnectionInput } from "@/bindings/ConnectionInput";
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
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConnections } from "@/features/connections/store";
import { useUi } from "@/features/shell/ui-store";
import { notifyError } from "@/lib/errors";
import { toInput } from "@/lib/to-input";
import { AuthTab } from "./AuthTab";
import { FormProvider } from "./form-context";
import type { BackendFieldError, ConnectionFormValues } from "./form-values";
import {
  backendFieldError,
  connectionFormSchema,
  toConnectionInput,
  toFormValues,
} from "./form-values";
import { GeneralTab } from "./GeneralTab";
import { ProtocolSwitch } from "./ProtocolSwitch";

/** Which tab holds each form field, so a backend error can open that tab. */
const TAB_BY_FIELD: Record<keyof ConnectionFormValues, "general" | "authentication"> = {
  protocol: "general",
  name: "general",
  host: "general",
  port: "general",
  username: "general",
  groupId: "general",
  tags: "general",
  color: "general",
  notes: "general",
  sshAuthMethod: "authentication",
  sshKeyPath: "authentication",
  rdpDomain: "authentication",
};

export function ConnectionEditor() {
  const { t } = useTranslation();
  const portTouched = useRef(false);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"general" | "authentication">("general");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const target = useUi((state) => state.editor);
  const closeEditor = useUi((state) => state.closeEditor);
  const templates = useConnections((state) => state.templates);

  const form = useForm<ConnectionFormValues>({
    resolver: zodResolver(connectionFormSchema),
    mode: "onChange",
  });
  const { isValid, isDirty, isSubmitting } = form.formState;

  // (Re)build the form each time the editor opens on a new target.
  useEffect(() => {
    if (!target || !templates) return;
    let base: ConnectionInput;
    if (target.mode === "create") {
      base = templates[target.protocol ?? "ssh"];
    } else {
      const found = useConnections.getState().connections.find((c) => c.id === target.id);
      if (!found) {
        closeEditor();
        notifyError({ kind: "notFound", message: "Connection not found", detail: null });
        return;
      }
      base = toInput(found);
    }
    form.reset(toFormValues(base, templates));
    setSavedName(target.mode === "edit" ? base.name : null);
    setActiveTab("general");
  }, [target, templates, form, closeEditor]);

  const save = async () => {
    if (!target || !isValid || !templates) return;
    const connection =
      target.mode === "edit"
        ? useConnections.getState().connections.find((c) => c.id === target.id)
        : undefined;
    const base: ConnectionInput =
      connection ?? templates[target.mode === "create" ? (target.protocol ?? "ssh") : "ssh"];
    const input = toConnectionInput(form.getValues(), base, templates);

    const result =
      target.mode === "create"
        ? await useConnections.getState().create(input)
        : await useConnections.getState().update(target.id, input);

    if (result.ok) {
      closeEditor();
      toast.success(t("editor.saved", { name: savedName ?? input.name }));
      return;
    }

    const fieldError = backendFieldError(result.error);
    if (fieldError) attachFieldError(fieldError);
    else notifyError(result.error);
  };

  /** Attaches a backend error to its field and opens the tab holding it. */
  function attachFieldError({ field, message }: BackendFieldError) {
    form.setError(field, { message });
    setActiveTab(TAB_BY_FIELD[field]);
  }

  const remove = async () => {
    if (target?.mode !== "edit") return;
    if (await useConnections.getState().remove(target.id)) closeEditor();
  };

  const requestClose = () => {
    if (isDirty) setDiscardOpen(true);
    else closeEditor();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (isValid) void save();
    }
  };

  return (
    <FormProvider value={form}>
      <Sheet
        open={target !== null}
        onOpenChange={(next) => {
          if (next) return;
          requestClose();
        }}
      >
        <SheetContent className="flex h-full flex-col gap-4 data-[side=right]:w-full data-[side=right]:sm:max-w-[520px]">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle>
                {target?.mode === "edit" && savedName
                  ? t("editor.editTitle", { name: savedName })
                  : t("editor.createTitle")}
              </SheetTitle>
              <ProtocolSwitch portTouched={portTouched} />
            </div>
          </SheetHeader>

          <fieldset
            data-slot="editor-scroll"
            className="min-h-0 flex-1 overflow-y-auto border-none"
            onKeyDown={onKeyDown}
          >
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as never)}>
              <TabsList>
                <TabsTrigger value="general">{t("editor.tabs.general")}</TabsTrigger>
                <TabsTrigger value="authentication">{t("editor.tabs.authentication")}</TabsTrigger>
              </TabsList>
              <TabsContent value="general">
                <GeneralTab portTouched={portTouched} />
              </TabsContent>
              <TabsContent value="authentication">
                <AuthTab />
              </TabsContent>
            </Tabs>
          </fieldset>

          <SheetFooter className="items-center sm:flex-row sm:justify-between">
            <Button
              variant="destructive"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={target?.mode !== "edit"}
            >
              {t("common.delete")}
            </Button>
            <div className="flex flex-1 justify-end gap-2">
              <Button variant="outline" onClick={requestClose}>
                {t("common.cancel")}
              </Button>
              <Button onClick={save} disabled={!isValid || isSubmitting}>
                {t("common.save")}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("editor.discardTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("editor.discardDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDiscardOpen(false)}>
              {t("editor.keepEditing")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDiscardOpen(false);
                closeEditor();
              }}
            >
              {t("editor.discard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.delete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("editor.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmDeleteOpen(false)}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={remove}>{t("common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FormProvider>
  );
}
