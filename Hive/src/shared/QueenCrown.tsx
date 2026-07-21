/**
 * Queen's crown — a rounded tiara with jewelled tips, distinct from lucide's
 * pointed king's crown. Lucide-compatible: sized via `size` or a CSS class.
 */
export default function QueenCrown({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3.5 18 L3.2 8.4 Q3.4 7.7 4 8 L7.6 11.3 Q8.1 11.6 8.4 10.9 L11.3 5.3 Q12 4.1 12.7 5.3 L15.6 10.9 Q15.9 11.6 16.4 11.3 L20 8 Q20.6 7.7 20.8 8.4 L20.5 18 Z" />
      <path d="M4 15.4 H20" />
      <circle cx="12" cy="3.7" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="3.4" cy="7.7" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="20.6" cy="7.7" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}
