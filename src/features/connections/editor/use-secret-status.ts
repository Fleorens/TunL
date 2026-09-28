// Whether a connection already has a secret of `kind` in the keyring (S2: a presence test only).
import { useEffect, useRef, useState } from "react";
import type { SecretKind } from "@/bindings/SecretKind";
import { notifyError, toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";

/** Presence of the secret: `none` (never / not stored), `loading`, `saved`, or the keyring down. */
export type SecretStatus = "none" | "loading" | "saved" | "unavailable";

/**
 * The status of one kind of secret for one connection.
 *
 * `null` (a connection being created) is `none` without asking. Otherwise it loads, then is
 * `saved` or `none`. A keyring error is `unavailable`; any other error is `none` and reported.
 * A late answer after the id changed is ignored.
 */
export function useSecretStatus(connectionId: string | null, kind: SecretKind): SecretStatus {
  const [status, setStatus] = useState<SecretStatus>("loading");
  const cancelled = useRef(false);

  useEffect(() => {
    if (!connectionId) {
      cancelled.current = true;
      setStatus("none");
      return;
    }

    cancelled.current = false;
    setStatus("loading");
    ipc
      .secretHas(connectionId, kind)
      .then((has) => {
        if (cancelled.current) return;
        setStatus(has ? "saved" : "none");
      })
      .catch((error) => {
        if (cancelled.current) return;
        const appError = toAppError(error);
        if (appError.kind === "secret") {
          setStatus("unavailable");
          return;
        }
        notifyError(appError);
        setStatus("none");
      });

    return () => {
      cancelled.current = true;
    };
  }, [connectionId, kind]);

  return status;
}
