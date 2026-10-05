import type { SVGProps } from 'react'

/** Queen Bee's mark: a hive cell holding a crown. Same 24px grid and stroke as lucide icons. */
export function QueenIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M8 15h8l.6-5.5-2.8 2L12 8.5l-1.8 3-2.8-2z" />
    </svg>
  )
}
