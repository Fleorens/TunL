import { createContext, useContext } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { ConnectionFormValues } from "./form-values";

/**
 * Context carrying the connection editor form down to the sub-components. RHF v7 does not export its
 * own `FormContext`, so this one wraps the same `UseFormReturn` shape.
 */
const FormContext = createContext<UseFormReturn<ConnectionFormValues> | null>(null);

/** Provides the form to the editor tree. */
export const FormProvider = FormContext.Provider;

/** Access the connection editor form from any sub-component. */
export const useFormHook = () => {
  const form = useContext(FormContext);
  if (!form) {
    throw new Error("ConnectionEditor: form context is missing");
  }
  return form;
};
