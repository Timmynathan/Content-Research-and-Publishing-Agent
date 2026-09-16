import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import Spinner from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

// A button that resizes on click is jarring — the label stays in the
// layout (just hidden) while loading, and the spinner is absolutely
// positioned on top, so the box never changes size.
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, disabled, className, children, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={["ui-btn", `ui-btn-${variant}`, `ui-btn-${size}`, className].filter(Boolean).join(" ")}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <span className="ui-btn-label" style={loading ? { visibility: "hidden" } : undefined}>
        {children}
      </span>
      {loading && (
        <span className="ui-btn-spinner" aria-hidden="true">
          <Spinner size={14} />
        </span>
      )}
    </button>
  );
});

export default Button;
