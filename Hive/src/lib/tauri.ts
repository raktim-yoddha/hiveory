// Tauri API wrapper - only available in Tauri environment
// This file handles conditional loading of Tauri APIs to avoid SSR issues

// Stub functions for SSR
const stubInvoke = async <T>(cmd: string, args?: any): Promise<T> => {
  return Promise.reject(new Error('Tauri APIs not available'));
};
const stubOpen = async <T>(options?: T): Promise<T | null> => null as any;
const stubSave = async (options?: any): Promise<string | null> => null as any;
const stubGetCurrentWindow = () => null as any;

let cachedAPIs: any = null;
let isLoading = false;

export const getTauriAPIs = () => {
  // Return cached APIs if available
  if (cachedAPIs) return cachedAPIs;
  
  // Return stubs if not in browser or still loading
  if (typeof window === 'undefined' || isLoading) {
    return {
      invoke: stubInvoke,
      open: stubOpen,
      save: stubSave,
      getCurrentWindow: stubGetCurrentWindow,
    };
  }
  
  // Start loading real APIs asynchronously
  loadTauriAPIs();
  
  // Return stubs for now, will be replaced once loaded
  return {
    invoke: stubInvoke,
    open: stubOpen,
    save: stubSave,
    getCurrentWindow: stubGetCurrentWindow,
  };
};

// Function to load real Tauri APIs dynamically
export const loadTauriAPIs = async () => {
  if (typeof window === 'undefined') return null;
  if (cachedAPIs) return cachedAPIs;
  if (isLoading) return null;
  
  isLoading = true;
  
  try {
    const tauriCore = await import('@tauri-apps/api/core');
    const tauriDialog = await import('@tauri-apps/plugin-dialog');
    const tauriWindow = await import('@tauri-apps/api/window');
    
    cachedAPIs = {
      invoke: tauriCore.invoke,
      open: tauriDialog.open,
      save: tauriDialog.save,
      getCurrentWindow: tauriWindow.getCurrentWindow,
    };
    return cachedAPIs;
  } catch (e) {
    console.error('Failed to load Tauri APIs:', e);
    return null;
  } finally {
    isLoading = false;
  }
};
