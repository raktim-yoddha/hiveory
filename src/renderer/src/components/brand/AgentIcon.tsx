import type { SVGProps } from 'react'

/**
 * Hiveory's mark for "agent": a hive cell holding a terminal prompt. Drawn on
 * lucide's 24px grid with the same stroke, so it sizes and colours like any icon.
 */
export function AgentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="m8 9.5 2.5 2.5L8 14.5" />
      <path d="M12.5 14.5H16" />
    </svg>
  )
}
