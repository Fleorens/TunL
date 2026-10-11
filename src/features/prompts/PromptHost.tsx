// Listen for the prompts the backend poses and show the first one, only, at a time (T21b).
// Mounted once in `AppLayout`; the queue and the three dialogues live beside it.
import { useEffect } from "react";
import type { PromptRequest } from "@/bindings/PromptRequest";
import { onPrompt } from "@/lib/events";
import { PromptHostKey } from "./PromptHostKey";
import { PromptInteractive } from "./PromptInteractive";
import { PromptPassword } from "./PromptPassword";
import { usePrompts } from "./store";

export function PromptHost() {
  useEffect(() => {
    const unsubscribe = onPrompt((request: PromptRequest) => usePrompts.getState().push(request));
    return unsubscribe;
  }, []);

  const request = usePrompts((state) => state.queue[0]);
  if (!request) return null;

  switch (request.prompt.kind) {
    case "hostKeyUnknown":
      return <PromptHostKey key={request.id} id={request.id} prompt={request.prompt} />;
    case "password":
    case "passphrase":
      return <PromptPassword key={request.id} id={request.id} prompt={request.prompt} />;
    case "keyboardInteractive":
      return <PromptInteractive key={request.id} id={request.id} prompt={request.prompt} />;
  }
}
