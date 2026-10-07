// Node stand-in for expo-secure-store in logic tests (the real one is native).
const values = new Map<string, string>()
export const getItemAsync = async (key: string) => values.get(key) ?? null
export const setItemAsync = async (key: string, value: string) => void values.set(key, value)
export const deleteItemAsync = async (key: string) => void values.delete(key)
