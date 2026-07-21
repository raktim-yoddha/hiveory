/**
 * OpenComb mark — a stylised code-bracket cube, for the Open-VSX (VS Code
 * server) component. Sized via `size` or a CSS class.
 */
export default function OpenVsxLogo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="HiveExtension"
    >
      <path d="M12 2.5 20.5 7 V17 L12 21.5 3.5 17 V7 Z" opacity="0.5" />
      <path d="M10 9.5 7.5 12 10 14.5" />
      <path d="M14 9.5 16.5 12 14 14.5" />
    </svg>
  );
}
