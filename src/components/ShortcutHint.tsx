import { Kbd, KbdGroup } from "@/components/ui/kbd";

interface ShortcutHintProps {
  keys: readonly string[];
  className?: string;
}

export function ShortcutHint({ keys, className }: ShortcutHintProps) {
  return (
    <KbdGroup className={className}>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}
