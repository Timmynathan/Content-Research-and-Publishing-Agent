import type { ReactNode } from "react";

/**
 * Label above, never a placeholder standing in as a label. Pass the
 * actual input/textarea/select as children with className="ui-input"
 * (or "ui-textarea") already on it — this wrapper only owns the label,
 * hint and error text around it, so it doesn't touch how any field's
 * value/onChange logic works.
 */
export default function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="ui-field">
      <label className="ui-field-label" htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="ui-field-required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <span className="ui-field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="ui-field-hint">{hint}</span>
      ) : null}
    </div>
  );
}
