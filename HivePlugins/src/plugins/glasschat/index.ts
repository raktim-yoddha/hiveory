import type { HivePlugin } from "../../types";
import { GlassChatEmbed } from "./GlassChatEmbed";

export const GlassChatPlugin: HivePlugin = {
  manifest: {
    id: "glasschat",
    name: "GlassChat",
    version: "1.0.0",
    description: "Embedded team chat & customer support workspace",
    category: "chat",
    ui: {
      surface: "dock",
      layout: "embedded",
      iconName: "MessageSquareText",
    },
  },
  Component: GlassChatEmbed,
};

export * from "./GlassChatEmbed";
export * from "./platformApi";
