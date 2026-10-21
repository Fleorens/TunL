import type { ComponentProps, JSX } from "react";
import { useId } from "react";
import { cn } from "@/lib/utils";

interface LogoProps extends ComponentProps<"svg"> {
  /** The SVG size, in pixels. */
  size?: number;
}

export function Logo({ size = 20, className, ...props }: LogoProps): JSX.Element {
  const gradientId = `tunl-logo-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      {...props}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--brand-from)" />
          <stop offset="1" stopColor="var(--brand-to)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill={`url(#${gradientId})`} />
      <path
        d="M8.5 24.5V15a7.5 7.5 0 0 1 15 0v9.5"
        stroke="white"
        strokeOpacity="0.95"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M13 17.5l2.6 2.5-2.6 2.5"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M17.2 22.5h2.6" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

type WordmarkProps = Omit<ComponentProps<"span">, "children">;

export function Wordmark(props: WordmarkProps): JSX.Element {
  return (
    <span {...props} className={cn("text-[15px] font-semibold tracking-tight", props.className)}>
      Tun<span className="text-brand-gradient">L</span>
    </span>
  );
}
