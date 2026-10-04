import logo from '@resources/icon.png'
import styles from './AppLogo.module.css'

/** Hiveory's logo. The single source image (`resources/icon.png`) also brands the window and installers. */
export function AppLogo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <img src={logo} alt="" aria-hidden className={styles[size]} draggable={false} />
}
