const BARS = 4

/**
 * Reasoning effort as ascending bars (like a signal meter): how many are lit
 * shows where the level sits among the model's own levels.
 */
export function EffortIcon({ level, levels }: { level?: string; levels: string[] }) {
  const index = level ? levels.indexOf(level) : -1
  const lit = index < 0 ? 0 : Math.max(1, Math.round(((index + 1) / levels.length) * BARS))
  return (
    <svg viewBox="0 0 16 16" aria-hidden width="14" height="14">
      {Array.from({ length: BARS }, (_, i) => {
        const height = 4 + i * 3
        return (
          <rect
            key={i}
            x={1 + i * 4}
            y={15 - height}
            width="2.5"
            height={height}
            rx="1"
            fill="currentColor"
            opacity={i < lit ? 1 : 0.28}
          />
        )
      })}
    </svg>
  )
}
