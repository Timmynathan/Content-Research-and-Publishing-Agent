import type { ReactNode } from "react";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

/**
 * Used everywhere for stages and states. The word is always visible —
 * state is never encoded in colour alone, which fails for colourblind
 * users and fails in a screenshot.
 */
export default function StatusPill({
  tone = "neutral",
  dot = false,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`ui-pill ui-pill-${tone}`}>
      {dot && <span className="ui-pill-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
