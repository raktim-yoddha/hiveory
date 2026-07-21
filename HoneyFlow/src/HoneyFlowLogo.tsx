/**
 * HoneyFlow mark — a honeycomb cell with a flow stream running through it,
 * for the board's fullscreen/maximized header. Sized via `size` or a class.
 */
export default function HoneyFlowLogo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-label="HoneyFlow"
    >
      <path
        d="M12 2.6 20 7.1 V16.9 L12 21.4 4 16.9 V7.1 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <path
        d="M6.5 14.5 C9 14.5 9 9.5 12 9.5 C15 9.5 15 14.5 17.5 14.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="6.5" cy="14.5" r="1.5" fill="currentColor" />
      <circle cx="17.5" cy="14.5" r="1.5" fill="currentColor" />
    </svg>
  );
}
