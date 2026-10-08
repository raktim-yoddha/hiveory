import { Check } from 'lucide-react-native'
import { THEME_NAMES, useTheme, type ThemeChoice } from '@/core/theme'
import { ListRow, Sheet } from '@/core/ui'

export const THEME_LABEL: Record<string, string> = { dark: 'Dark', bronze: 'Bronze', silver: 'Silver', midnight: 'Midnight', jade: 'Jade', rose: 'Rose' }

export const themeLabel = (choice: ThemeChoice, computerTheme?: string): string =>
  choice === 'computer' ? `Same as computer${computerTheme ? ` (${THEME_LABEL[computerTheme] ?? computerTheme})` : ''}` : (THEME_LABEL[choice] ?? choice)

/** The phone's own theme, or the computer's. Only the phone changes. */
export function ThemeSheet({ open, onClose, computerTheme }: { open: boolean; onClose: () => void; computerTheme?: string }) {
  const { colors, choice, setChoice } = useTheme()
  return (
    <Sheet open={open} title="Theme" onClose={onClose}>
      {(['computer', ...THEME_NAMES] as ThemeChoice[]).map((option) => (
        <ListRow
          key={option}
          title={themeLabel(option, computerTheme)}
          label={`${themeLabel(option, computerTheme)}${choice === option ? ', selected' : ''}`}
          trailing={choice === option ? <Check size={18} color={colors.accent} accessibilityLabel="Selected" /> : null}
          onPress={() => {
            setChoice(option)
            onClose()
          }}
        />
      ))}
    </Sheet>
  )
}
