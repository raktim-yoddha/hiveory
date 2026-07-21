import type { HivePlugin, PluginManifest } from "./types";

class PluginRegistry {
  private plugins: Map<string, HivePlugin> = new Map();

  /** Register a new third-party or built-in plugin */
  public register(plugin: HivePlugin): void {
    if (this.plugins.has(plugin.manifest.id)) {
      console.warn(`[HivePlugins] Overwriting plugin registration: ${plugin.manifest.id}`);
    }
    this.plugins.set(plugin.manifest.id, plugin);
  }

  /** Get a registered plugin by ID */
  public get(id: string): HivePlugin | undefined {
    return this.plugins.get(id);
  }

  /** List all registered plugins */
  public getAll(): HivePlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Get plugins matching a specific UI surface */
  public getBySurface(surface: "dock" | "plane" | "sidebar"): HivePlugin[] {
    return this.getAll().filter((p) => p.manifest.ui.surface === surface);
  }
}

export const registry = new PluginRegistry();
