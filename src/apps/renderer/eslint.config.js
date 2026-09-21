import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'src/generated'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-globals': ['error',
        { name: 'alert', message: 'Use useHiveoryDialogs() instead of a browser-native alert.' },
        { name: 'confirm', message: 'Use useHiveoryDialogs() instead of a browser-native confirmation.' },
        { name: 'prompt', message: 'Use useHiveoryDialogs() instead of a browser-native prompt.' },
      ],
      'no-restricted-properties': ['error',
        { object: 'window', property: 'alert', message: 'Use useHiveoryDialogs() instead of a browser-native alert.' },
        { object: 'window', property: 'confirm', message: 'Use useHiveoryDialogs() instead of a browser-native confirmation.' },
        { object: 'window', property: 'prompt', message: 'Use useHiveoryDialogs() instead of a browser-native prompt.' },
      ],
    },
  },
)
