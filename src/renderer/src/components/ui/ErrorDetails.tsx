import styles from './ErrorDetails.module.css'

/** Technical details behind a disclosure — never the primary error message (STARTER_PROMPT §20). */
export function ErrorDetails({ detail }: { detail?: string }) {
  if (!detail) return null
  return (
    <details className={styles.details}>
      <summary className={styles.summary}>Technical details</summary>
      <pre className={styles.pre}>{detail}</pre>
    </details>
  )
}
