import React from 'react'

export interface CliIconProps {
  size?: number
  className?: string
  style?: React.CSSProperties
}

/** Anthropic Claude Code — terracotta sunburst asterisk */
export const ClaudeCodeIcon: React.FC<CliIconProps> = ({ size = 14, className, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ color: '#d97706', flexShrink: 0, ...style }}
    aria-hidden="true"
  >
    <path
      d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
    />
  </svg>
)

/** OpenAI Codex CLI — authentic OpenAI 6-fold spiral rosette */
export const CodexIcon: React.FC<CliIconProps> = ({ size = 14, className, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ color: '#10a37f', flexShrink: 0, ...style }}
    aria-hidden="true"
  >
    <path
      d="M21.5 9.7a6.2 6.2 0 0 0-.5-4.9 6.3 6.3 0 0 0-5.7-3.4 6.2 6.2 0 0 0-3.3 1 6.3 6.3 0 0 0-4.8 2.3 6.3 6.3 0 0 0-1.5 5.6 6.2 6.2 0 0 0-1.9 4.5 6.3 6.3 0 0 0 2.7 5.1 6.3 6.3 0 0 0 5.7 3.4 6.2 6.2 0 0 0 3.3-1 6.3 6.3 0 0 0 4.8-2.3 6.3 6.3 0 0 0 1.5-5.6 6.2 6.2 0 0 0 1.9-4.5 6.3 6.3 0 0 0-2.2-0.2zm-7.6 11.2a4.4 4.4 0 0 1-2.4.7 4.5 4.5 0 0 1-4.1-2.4l.1-.1 3.7-2.1a1 1 0 0 0 .5-.9v-5.2l1.6.9a1 1 0 0 0 .5.1v5a4.4 4.4 0 0 1 .1 3.9zm-8-3.4a4.4 4.4 0 0 1-.6-2.4 4.5 4.5 0 0 1 1.7-3.5l.1.1 3.7 2.1a1 1 0 0 0 1 0l4.5-2.6v1.8a1 1 0 0 0 .5.9l-4.3 2.5a4.4 4.4 0 0 1-3.6 1.1zm-1.8-8.8a4.4 4.4 0 0 1 1.8-1.7 4.5 4.5 0 0 1 4.5.1l-.1.1-3.7 2.1a1 1 0 0 0-.5.9v5.2l-1.6-.9a1 1 0 0 0-.5-.1v-5a4.4 4.4 0 0 1 .1-.7zm14.3 2.7l-4.5 2.6v-1.8a1 1 0 0 0-.5-.9l4.3-2.5a4.4 4.4 0 0 1 3.6-1.1 4.4 4.4 0 0 1 .6 2.4 4.5 4.5 0 0 1-1.7 3.5l-.1-.1-3.7-2.1a1 1 0 0 0-1 0zm2.4-3.8a4.4 4.4 0 0 1-1.8 1.7 4.5 4.5 0 0 1-4.5-.1l.1-.1 3.7-2.1a1 1 0 0 0 .5-.9v-5.2l1.6.9a1 1 0 0 0 .5.1v5a4.4 4.4 0 0 1-.1.7z"
      fill="currentColor"
    />
  </svg>
)

/** Google Antigravity — authentic refractive delta / prism spark */
export const AntigravityIcon: React.FC<CliIconProps> = ({ size = 14, className, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ color: '#a855f7', flexShrink: 0, ...style }}
    aria-hidden="true"
  >
    <path
      d="M12 2.5L21.5 19H2.5L12 2.5Z"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinejoin="round"
    />
    <path
      d="M12 7.5L17.5 17H6.5L12 7.5Z"
      fill="currentColor"
      opacity="0.35"
    />
    <circle cx="12" cy="13.5" r="2" fill="currentColor" />
  </svg>
)

/** OpenCode — authentic OpenCode terminal square prompt */
export const OpenCodeIcon: React.FC<CliIconProps> = ({ size = 14, className, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ color: '#22c55e', flexShrink: 0, ...style }}
    aria-hidden="true"
  >
    <rect
      x="3"
      y="3"
      width="18"
      height="18"
      rx="5"
      stroke="currentColor"
      strokeWidth="2.2"
    />
    <path
      d="M7.5 9L11.5 12L7.5 15"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.5 15H16.5"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  </svg>
)

/** Google Gemini — authentic dual-spark four-point star */
export const GeminiIcon: React.FC<CliIconProps> = ({ size = 14, className, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ color: '#38bdf8', flexShrink: 0, ...style }}
    aria-hidden="true"
  >
    <path
      d="M12 2C12 7.523 7.523 12 2 12C7.523 12 12 16.477 12 22C12 16.477 16.477 12 22 12C16.477 12 12 7.523 12 2Z"
      fill="currentColor"
    />
  </svg>
)

/** GitHub Copilot — authentic pilot robot */
export const CopilotIcon: React.FC<CliIconProps> = ({ size = 14, className, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ color: '#818cf8', flexShrink: 0, ...style }}
    aria-hidden="true"
  >
    <path
      d="M12 3C7 3 3 7 3 12v3a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-3c0-5-4-9-9-9zM9 13.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm6 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"
      fill="currentColor"
    />
  </svg>
)

/** Cursor CLI — authentic 3D box arrow */
export const CursorIcon: React.FC<CliIconProps> = ({ size = 14, className, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ color: '#60a5fa', flexShrink: 0, ...style }}
    aria-hidden="true"
  >
    <path
      d="M12 2L21 7.2V17.6L12 22.8L3 17.6V7.2L12 2Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path
      d="M12 2V22.8M21 7.2L3 17.6M3 7.2L21 17.6"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
)

export interface CliBrandIconProps {
  identifier?: string | null
  size?: number
}

/** Renders the matching brand icon for any adapter ID or title */
export const CliBrandIcon: React.FC<CliBrandIconProps> = ({ identifier, size = 14 }) => {
  const id = (identifier || '').toLowerCase()

  if (id.includes('claude')) {
    return <ClaudeCodeIcon size={size} />
  }
  if (id.includes('codex') || id.includes('openai')) {
    return <CodexIcon size={size} />
  }
  if (id.includes('antigravity') || id.includes('agy')) {
    return <AntigravityIcon size={size} />
  }
  if (id.includes('opencode') || id.includes('open-code')) {
    return <OpenCodeIcon size={size} />
  }
  if (id.includes('gemini')) {
    return <GeminiIcon size={size} />
  }
  if (id.includes('copilot')) {
    return <CopilotIcon size={size} />
  }
  if (id.includes('cursor')) {
    return <CursorIcon size={size} />
  }

  return <ClaudeCodeIcon size={size} />
}
