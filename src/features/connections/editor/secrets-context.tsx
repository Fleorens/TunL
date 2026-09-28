// The secret drafts the editor holds for the connection being edited, shared by every SecretField
// (S2: the drafts live out of react-hook-form, so one context carries them down to the fields).
import { createContext, useContext } from "react";
import type { SecretKind } from "@/bindings/SecretKind";
import type { SecretDraft, SecretDrafts } from "./secret-drafts";

/** The drafts the editor edits, the id to test presence against, and a setter for one kind. */
export type SecretEditorContextValue = {
  connectionId: string | null;
  drafts: SecretDrafts;
  /** Replace one kind's draft with a new value, returning a new object. */
  setDraft: (kind: SecretKind, draft: SecretDraft) => void;
};

const SecretEditorContext = createContext<SecretEditorContextValue | null>(null);

/** Provides the editor's secret drafts down to the fields. */
export const SecretEditorProvider = SecretEditorContext.Provider;

/** Read the editor's secret drafts from any field. */
export function useSecretEditor() {
  const context = useContext(SecretEditorContext);
  if (!context) {
    throw new Error("ConnectionEditor: secrets context is missing");
  }
  return context;
}
