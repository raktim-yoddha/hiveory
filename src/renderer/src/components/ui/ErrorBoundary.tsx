import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from './Button'
import { ErrorDetails } from './ErrorDetails'
import styles from './ErrorBoundary.module.css'

interface ErrorBoundaryProps {
  /** Names the region so the fallback says what broke, e.g. "Kanban board". */
  region: string
  children: ReactNode
  compact?: boolean
  /** Changing this key resets the boundary (e.g. when navigating). */
  resetKey?: string
}

interface ErrorBoundaryState {
  error: Error | null
  resetKey?: string
}

/**
 * Isolates a UI region: if it throws, only that region shows a recoverable
 * fallback while the rest of the app keeps working.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): Partial<ErrorBoundaryState> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.region}]`, error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className={this.props.compact ? styles.compact : styles.root} role="alert">
        <AlertTriangle className={styles.icon} aria-hidden />
        <p className={styles.title}>{this.props.region} failed to display</p>
        <p className={styles.text}>The rest of Hiveory is unaffected.</p>
        <Button size="sm" icon={<RotateCcw />} onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
        <ErrorDetails detail={error.stack ?? error.message} />
      </div>
    )
  }
}
