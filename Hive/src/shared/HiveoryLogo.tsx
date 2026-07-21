/**
 * Hiveory mark — geometric honeybee: striped teardrop body, twin honey wings,
 * round-tipped antennae. Legible at 16px, works on light and dark. Used in the
 * title bar and, rendered to PNG, as the app/taskbar icon.
 */
export default function HiveoryLogo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Hiveory"
    >
      <defs>
        <linearGradient id="hv-bee-g" x1="24" y1="12" x2="24" y2="43" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffd257" />
          <stop offset="1" stopColor="#e8a512" />
        </linearGradient>
        <clipPath id="hv-bee-c">
          <path d="M24 13C30.5 13 33.5 18.5 33.5 24.5C33.5 32 29.5 39.5 24 42.5C18.5 39.5 14.5 32 14.5 24.5C14.5 18.5 17.5 13 24 13Z" />
        </clipPath>
      </defs>
      <g transform="rotate(-8 24 24)">
        <ellipse cx="14.2" cy="15.5" rx="8" ry="4.8" transform="rotate(-38 14.2 15.5)" fill="#ffe9ad" stroke="#d99a1c" strokeWidth="1.2" />
        <ellipse cx="33.8" cy="15.5" rx="8" ry="4.8" transform="rotate(38 33.8 15.5)" fill="#ffe9ad" stroke="#d99a1c" strokeWidth="1.2" />
        <path d="M22.3 13.2C21.6 10.4 20.8 8.6 19.8 7.1" stroke="#171106" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M25.7 13.2C26.4 10.4 27.2 8.6 28.2 7.1" stroke="#171106" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="19.5" cy="6.6" r="1.4" fill="#171106" />
        <circle cx="28.5" cy="6.6" r="1.4" fill="#171106" />
        <path d="M24 13C30.5 13 33.5 18.5 33.5 24.5C33.5 32 29.5 39.5 24 42.5C18.5 39.5 14.5 32 14.5 24.5C14.5 18.5 17.5 13 24 13Z" fill="url(#hv-bee-g)" />
        <g clipPath="url(#hv-bee-c)" fill="#171106">
          <rect x="12" y="19" width="24" height="4.6" />
          <rect x="12" y="26.4" width="24" height="4.6" />
          <rect x="12" y="33.8" width="24" height="4.6" />
        </g>
      </g>
    </svg>
  );
}
