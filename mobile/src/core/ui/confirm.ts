import { Alert } from 'react-native'

/** Asks before something that cannot be undone (deleting, removing); `onYes` runs only on the destructive choice. */
export const confirm = (title: string, body: string, action: string, onYes: () => void): void =>
  Alert.alert(title, body, [
    { text: 'Cancel', style: 'cancel' },
    { text: action, style: 'destructive', onPress: onYes }
  ])

/** A few choices for one item (the long-press menu of a row); the last is always Cancel. */
export const choose = (title: string, choices: { label: string; destructive?: boolean; onPress: () => void }[]): void =>
  Alert.alert(title, undefined, [...choices.map((c) => ({ text: c.label, style: c.destructive ? ('destructive' as const) : ('default' as const), onPress: c.onPress })), { text: 'Cancel', style: 'cancel' }])
