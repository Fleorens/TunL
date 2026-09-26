import { toast } from "sonner";
import type { AppError } from "@/bindings/AppError";
import type { ErrorKind } from "@/bindings/ErrorKind";
import { i18n } from "@/i18n";

// A Record forces this list to stay exhaustive: adding a kind in Rust breaks the build here.
const KNOWN_KINDS: Record<ErrorKind, true> = {
  notFound: true,
  validation: true,
  io: true,
  store: true,
  secret: true,
  network: true,
  timeout: true,
  auth: true,
  hostKeyRejected: true,
  hostKeyChanged: true,
  cancelled: true,
  sftp: true,
  rdpClientMissing: true,
  rdp: true,
  wol: true,
  inUse: true,
  internal: true,
};

export function isErrorKind(value: unknown): value is ErrorKind {
  return typeof value === "string" && Object.hasOwn(KNOWN_KINDS, value);
}

/** Normalizes anything an ipc call can reject with (Rust AppError, JS Error, string…) into an AppError. */
export function toAppError(error: unknown): AppError {
  if (typeof error === "object" && error !== null && "kind" in error && "message" in error) {
    const { kind, message } = error;
    if (isErrorKind(kind) && typeof message === "string") {
      const detail = "detail" in error ? (error.detail as AppError["detail"]) : null;
      return { kind, message, detail: detail ?? null };
    }
  }
  if (error instanceof Error) {
    return { kind: "internal", message: error.message, detail: null };
  }
  return { kind: "internal", message: String(error), detail: null };
}

/** Shows a translated error toast for anything an ipc call rejected with, and returns the normalized error. */
export function notifyError(error: unknown): AppError {
  const appError = toAppError(error);
  toast.error(i18n.t(`errors.kind.${appError.kind}`), { description: appError.message });
  return appError;
}
