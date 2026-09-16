export default function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={["ui-spinner", className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
