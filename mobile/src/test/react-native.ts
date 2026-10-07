// Node stand-in for react-native in logic tests (only what non-UI modules read).
export const Platform = { OS: 'test', select: <T>(o: { default?: T }) => o.default }
