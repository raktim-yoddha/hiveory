import { api } from './api'

/** Opens a web page in the user's browser; a refused or failed open is not worth a notice. */
export const openUrl = (url: string): void => void api('system.openUrl', { url }).catch(() => undefined)
