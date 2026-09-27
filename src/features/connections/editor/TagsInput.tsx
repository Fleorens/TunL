import { useEffect, useRef, useState } from "react";
import { useController } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { FieldError } from "./FieldError";
import { useFormHook } from "./form-context";
import type { ArrayFieldName } from "./form-values";

/**
 * Tags as chips plus an input. Enter or `,` adds a trimmed tag (skipped when empty, already present, or the form is
 * full). Backspace on an empty input removes the last tag.
 *
 * By default it edits the general `tags` field, labelled « Tags »: each tag is lowercased, de-duplicated and capped at
 * ten. The RDP extra-arguments field reuses it with `name="rdpExtraArgs"`, `lowercase={false}`, `dedupe={false}` and
 * `max={20}`: the arguments are case-sensitive, may repeat, and the schema enforces the count
 * (docs/05-modele-donnees.md §6).
 */
export function TagsInput({
  name = "tags",
  label,
  lowercase = true,
  dedupe = true,
  max = 10,
}: {
  name?: ArrayFieldName;
  label?: string;
  lowercase?: boolean;
  dedupe?: boolean;
  max?: number;
} = {}) {
  const { t } = useTranslation();
  const form = useFormHook();
  const { field, fieldState } = useController({ name, control: form.control });
  const resolvedLabel = label ?? t("editor.fields.tags");
  const inputId = `${name}-input`;
  // RHF returns `undefined` for a field with no default yet (the reset effect runs after the
  // templates load), so fall back to an empty array until the form is populated.
  const tags = field.value ?? [];
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const prevTagsRef = useRef<string[]>([]);

  // Clear the local input when the tags reset (editor opening a new connection).
  useEffect(() => {
    const prev = prevTagsRef.current;
    prevTagsRef.current = tags;
    if (prev.length !== tags.length || !tags.every((tag, i) => tag === prev[i])) {
      setInput("");
    }
  }, [tags]);

  const addTag = () => {
    const raw = input.trim();
    const tag = lowercase ? raw.toLowerCase() : raw;
    if (!raw || (dedupe && tags.includes(tag)) || tags.length >= max) return;
    field.onChange([...tags, tag]);
    setInput("");
  };

  const removeTag = (tag: string) => {
    field.onChange(tags.filter((item) => item !== tag));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag();
    } else if (event.key === "Backspace" && input === "" && tags.length > 0) {
      event.preventDefault();
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>{resolvedLabel}</Label>
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-2 py-1">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-sm"
          >
            {tag}
            <button
              type="button"
              aria-label={t("editor.removeTag", { tag })}
              onClick={() => removeTag(tag)}
              className="inline-flex size-4 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={inputId}
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={resolvedLabel}
          className="min-w-[6rem] flex-1 border-none bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <FieldError message={fieldState.error?.message} />
    </div>
  );
}
