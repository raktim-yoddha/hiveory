/** Last part of a path, on any platform ("C:\code\app" and "/home/me/app" both give "app"). */
export const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
