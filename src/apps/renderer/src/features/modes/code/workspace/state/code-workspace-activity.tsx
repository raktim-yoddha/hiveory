import { createContext, useContext } from 'react'

export const CodeWorkspaceActivityContext = createContext(true)

export function useCodeWorkspaceActive(): boolean {
  return useContext(CodeWorkspaceActivityContext)
}
