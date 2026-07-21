import type { ReactNode, ComponentType } from "react";

export type PluginCategory = "chat" | "productivity" | "devtools" | "ai" | "custom";

export interface PluginUIConfig {
  /** Target surface in Hive desktop shell: 'dock' (right dock), 'plane' (center pane), 'sidebar' (left sidebar) */
  surface: "dock" | "plane" | "sidebar";
  /** Default layout mode for embedded iframe/widget */
  layout?: "embedded" | "desktop" | "fullscreen";
  /** Icon component key or name */
  iconName?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  category: PluginCategory;
  ui: PluginUIConfig;
  configSchema?: Record<string, { type: "string" | "boolean" | "number"; label: string; required?: boolean }>;
}

export interface HivePluginProps {
  projectPath?: string | null;
  activeWorkspaceId?: string;
  config?: Record<string, any>;
  onClose?: () => void;
  [key: string]: any;
}

export interface HivePlugin {
  manifest: PluginManifest;
  /** Main React UI component for the plugin */
  Component: ComponentType<any>;
  /** Optional initialization function when Hive boots */
  initialize?: (config?: Record<string, any>) => Promise<void>;
}
