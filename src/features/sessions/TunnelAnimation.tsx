import { motion } from "motion/react";
import { useId } from "react";

import { type Protocol, ProtocolIcon } from "@/components/ProtocolIcon";
import { useSettings } from "@/features/settings/store";
import { useReducedMotionNow } from "@/lib/motion";

const DELAYS = [0, 0.4, 0.8] as const;

// Fixed rings when motion is reduced: scaled and faded from the inside out.
const STATIC_RINGS = [
  { scale: 0.6, opacity: 0.8 },
  { scale: 1, opacity: 0.5 },
  { scale: 1.4, opacity: 0.2 },
] as const;

function stroke(grad: string) {
  return {
    fill: "none",
    stroke: `url(#${grad})`,
    strokeWidth: 1.5,
    x: 20,
    y: 20,
    width: 56,
    height: 56,
    rx: 14,
  };
}

/** Three rounded squares that grow and fade around the protocol icon while a connection starts. */
export function TunnelAnimation({ protocol }: { protocol: Protocol }) {
  const reduceMotionSetting = useSettings((state) => state.settings?.reduceMotion);
  const reduce = useReducedMotionNow(reduceMotionSetting);
  const gradientId = `tunl-tunnel-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <div
      aria-hidden="true"
      className="relative mx-auto flex size-24 items-center justify-center"
      data-tunnel
      data-animated={reduce ? "false" : "true"}
    >
      <svg viewBox="0 0 96 96" aria-hidden="true" className="absolute inset-0">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="96" y2="96">
            <stop stopColor="var(--brand-from)" />
            <stop offset="1" stopColor="var(--brand-to)" />
          </linearGradient>
        </defs>
        {[0, 1, 2].map((i) =>
          reduce ? (
            <rect key={i} {...stroke(gradientId)} style={STATIC_RINGS[i]} />
          ) : (
            <motion.rect
              key={i}
              {...stroke(gradientId)}
              initial={{ scale: 0.6, opacity: 0.8 }}
              animate={{ scale: 1.4, opacity: 0 }}
              transition={{ duration: 1.2, delay: DELAYS[i], repeat: Infinity, ease: "easeOut" }}
              style={{ transformOrigin: "48px 48px" }}
            />
          ),
        )}
      </svg>
      <ProtocolIcon protocol={protocol} className="relative size-6" />
    </div>
  );
}
