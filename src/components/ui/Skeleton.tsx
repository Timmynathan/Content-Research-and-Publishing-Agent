import type { CSSProperties } from "react";

/** A shimmering placeholder block, shaped like the real content — never a bare spinner on a blank page. */
export default function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={["ui-skeleton", className].filter(Boolean).join(" ")} style={style} aria-hidden="true" />;
}
