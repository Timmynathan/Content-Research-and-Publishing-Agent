import { AlertIcon } from "./icons";
import Button from "./Button";

/** What failed, in plain language, and what to do about it — never "Something went wrong." */
export default function ErrorState({
  message,
  onRetry,
  retrying,
  tone = "danger",
}: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  /** "warning" for an advisory notice (e.g. thinly sourced) rather than an actual failure. */
  tone?: "danger" | "warning";
}) {
  return (
    <div className={`ui-error ui-error-${tone}`} role="alert">
      <AlertIcon className="ui-error-icon" />
      <span className="ui-error-message">{message}</span>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} loading={retrying}>
          Retry
        </Button>
      )}
    </div>
  );
}
