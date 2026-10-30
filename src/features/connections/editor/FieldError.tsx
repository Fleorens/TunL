import { useTranslation } from "react-i18next";
import { isValidationCode } from "./validation";

/**
 * The validation message under a field.
 *
 * Client-side validation sends a code from `VALIDATION_CODES`; the backend sends technical English
 * (docs/06 S7) that the UI shows as it is. Translate only the codes, and pass anything else through untouched.
 *
 * When there is no message it renders an empty box of the same height, so the message appearing
 * below a field never shifts the rest of the form.
 */
export function FieldError({ message }: { message?: string }) {
  const { t } = useTranslation();
  if (!message) {
    return <span className="block min-h-[1.25rem]" aria-hidden="true" />;
  }
  return (
    <p role="alert" className="text-sm font-normal text-destructive">
      {isValidationCode(message) ? t(`validation.${message}`) : message}
    </p>
  );
}
