import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';

export interface TauriAPIs {
  invoke: typeof invoke;
  open: typeof open;
  save: typeof save;
  getCurrentWindow: typeof getCurrentWindow;
}

const apis: TauriAPIs = {
  invoke,
  open: open as any,
  save,
  getCurrentWindow,
};

export const getTauriAPIs = (): TauriAPIs => {
  return apis;
};

export const loadTauriAPIs = async (): Promise<TauriAPIs> => {
  return apis;
};
