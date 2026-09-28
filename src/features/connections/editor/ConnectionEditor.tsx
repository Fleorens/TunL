import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ConnectionInput } from "@/bindings/ConnectionInput";
import type { SecretKind } from "@/bindings/SecretKind";
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
import { toInput } from "@/features/connections/to-input";
import { useUi } from "@/features/shell/ui-store";
import { notifyError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { AdvancedTab } from "./AdvancedTab";
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
import { NetworkTab } from "./NetworkTab";
import { ProtocolSwitch } from "./ProtocolSwitch";
import type { SecretDraft, SecretDrafts } from "./secret-drafts";
import {
  secretKindsFor,
  secretOperations,
  secretsDirty,
  secretsValid,
  UNCHANGED_SECRETS,
  withDraft,
} from "./secret-drafts";
import { SecretEditorProvider } from "./secrets-context";

/** Which tab holds each form field, so a backend error can open that tab. */
const TAB_BY_FIELD: Record<
  keyof ConnectionFormValues,
  "general" | "authentication" | "network" | "advanced"
> = {
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
  jumpHostId: "network",
  wolEnabled: "network",
  wolMac: "network",
  wolBroadcast: "network",
  wolPort: "network",
  wolWakeBeforeConnect: "network",
  wolWaitTimeoutSecs: "network",
  sshKeepaliveSecs: "advanced",
  sshConnectTimeoutSecs: "advanced",
  rdpDisplayMode: "advanced",
  rdpWidth: "advanced",
  rdpHeight: "advanced",
  rdpMultimon: "advanced",
  rdpDynamicResolution: "advanced",
  rdpClipboard: "advanced",
  rdpShareHome: "advanced",
  rdpAudio: "advanced",
  rdpCertPolicy: "advanced",
  rdpExtraArgs: "advanced",
};

/** The editor tabs; Radix Tabs hands back a plain string, narrowed to this union. */
type EditorTab = "general" | "authentication" | "network" | "advanced";

export function ConnectionEditor() {
  const { t } = useTranslation();
  const portTouched = useRef(false);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>("general");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // The target the form was last reset for. Fields render only once it matches the open target:
  // before that, every field would be `undefined` (uncontrolled), then controlled after `reset`.
  const [readyFor, setReadyFor] = useState<typeof target>(null);
  // The secret drafts live out of the form: a secret is written, tested, forgotten — never a form value.
  const [drafts, setDrafts] = useState<SecretDrafts>(UNCHANGED_SECRETS);
  const setDraft = (kind: SecretKind, draft: SecretDraft) =>
    setDrafts((previous) => withDraft(previous, kind, draft));

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
    // Prefill a create target before the reset, so the prefilled values are the form's initial
    // values (it is not "modified"): the quick-connect address fills name, host, port and username.
    const values = toFormValues(base, templates);
    if (target.mode === "create" && target.prefill) {
      const { host, port, username } = target.prefill;
      values.name = host;
      values.host = host;
      values.port = String(port);
      values.username = username ?? "";
      // A port that differs from the template stays when switching protocol.
      if (port !== base.port) portTouched.current = true;
    }
    form.reset(values);
    setSavedName(target.mode === "edit" ? base.name : null);
    setActiveTab("general");
    setReadyFor(target);
    setDrafts(UNCHANGED_SECRETS);
  }, [target, templates, form, closeEditor]);

  // While the sheet slides out, `target` is already null: keep showing what it was showing.
  const shown = target ?? readyFor;
  const ready = shown !== null && readyFor === shown;

  const save = async () => {
    if (!target || !isValid || !secretsValid(drafts) || !templates) return;
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
      // Apply the drafts to the keyring (S2), in order; stop at the first failure, but close anyway.
      await applySecrets(result.value.id);
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

  /**
   * Apply the secret drafts to the keyring, for the relevant kinds only, in order.
   * Reports the first failure but does not rethrow: the connection is saved either way.
   */
  async function applySecrets(id: string) {
    const operations = secretOperations(drafts, secretKindsFor(form.getValues()));
    for (const operation of operations) {
      try {
        if (operation.type === "set") await ipc.secretSet(id, operation.kind, operation.value);
        else await ipc.secretDelete(id, operation.kind);
      } catch (error) {
        notifyError(error);
        return;
      }
    }
  }

  const remove = async () => {
    if (target?.mode !== "edit") return;
    if (await useConnections.getState().remove(target.id)) closeEditor();
  };

  const requestClose = () => {
    if (isDirty || secretsDirty(drafts)) setDiscardOpen(true);
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
      <SecretEditorProvider
        value={{ connectionId: shown?.mode === "edit" ? shown.id : null, drafts, setDraft }}
      >
        <Sheet
          open={target !== null}
          onOpenChange={(next) => {
            if (next) return;
            requestClose();
          }}
        >
          <SheetContent className="flex h-full flex-col gap-4 data-[side=right]:w-full data-[side=right]:sm:max-w-[520px]">
            <SheetHeader className="items-start gap-3">
              <SheetTitle>
                {shown?.mode === "edit" && savedName
                  ? t("editor.editTitle", { name: savedName })
                  : t("editor.createTitle")}
              </SheetTitle>
              {ready && <ProtocolSwitch portTouched={portTouched} />}
            </SheetHeader>

            <fieldset
              data-slot="editor-scroll"
              className="min-h-0 flex-1 overflow-y-auto border-none px-4"
              onKeyDown={onKeyDown}
            >
              {ready && (
                <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as EditorTab)}>
                  <TabsList>
                    <TabsTrigger value="general">{t("editor.tabs.general")}</TabsTrigger>
                    <TabsTrigger value="authentication">
                      {t("editor.tabs.authentication")}
                    </TabsTrigger>
                    <TabsTrigger value="network">{t("editor.tabs.network")}</TabsTrigger>
                    <TabsTrigger value="advanced">{t("editor.tabs.advanced")}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="general">
                    <GeneralTab portTouched={portTouched} />
                  </TabsContent>
                  <TabsContent value="authentication">
                    <AuthTab />
                  </TabsContent>
                  <TabsContent value="network">
                    <NetworkTab selfId={target?.mode === "edit" ? target.id : null} />
                  </TabsContent>
                  <TabsContent value="advanced">
                    <AdvancedTab />
                  </TabsContent>
                </Tabs>
              )}
            </fieldset>

            <SheetFooter className="items-center sm:flex-row sm:justify-between">
              {shown?.mode === "edit" && (
                <Button variant="destructive" onClick={() => setConfirmDeleteOpen(true)}>
                  {t("common.delete")}
                </Button>
              )}
              <div className="flex flex-1 justify-end gap-2">
                <Button variant="outline" onClick={requestClose}>
                  {t("common.cancel")}
                </Button>
                <Button onClick={save} disabled={!isValid || !secretsValid(drafts) || isSubmitting}>
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
      </SecretEditorProvider>
    </FormProvider>
  );
}
