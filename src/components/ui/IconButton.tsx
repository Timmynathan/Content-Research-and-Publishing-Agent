import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Size = "sm" | "md" | "lg";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: Size;
  /** Round, for the one legitimate circular case: an account/avatar trigger. */
  circular?: boolean;
  /** Icon-only buttons must always have an accessible name. */
  label: string;
  children: ReactNode;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = "md", circular = false, label, className, children, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      title={label}
      className={["ui-icon-btn", `ui-icon-btn-${size}`, circular ? "is-circular" : "", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;
