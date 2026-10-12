// Answer the prompt the backend posed: drop it from the queue, send the answer, and surface any real error.

import type { PromptAnswer } from "@/bindings/PromptAnswer";
import { notifyError, toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { usePrompts } from "./store";

/**
 * Resolve the prompt locally, then send the answer. A `notFound` rejection means the session finished
 * in between (closed or reconnecting): ignore it. Any other rejection is shown to the user.
 */
export async function answerPrompt(id: string, answer: PromptAnswer): Promise<void> {
  usePrompts.getState().resolve(id);
  try {
    await ipc.promptAnswer(id, answer);
  } catch (error) {
    if (toAppError(error).kind === "notFound") return;
    notifyError(error);
  }
}
