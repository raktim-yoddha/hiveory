"use client";

import { useState } from "react";
import { X, Server, Puzzle } from "lucide-react";
import ProvidersSection from "./ProvidersSection";
import ModelsSection from "./ModelsSection";

interface SettingsPageProps {
  onClose: () => void;
}

// Only sections that are actually implemented get a nav entry — a nav item that
// opens a "coming soon" panel is a dead end.
type SectionId = "models" | "providers";

interface NavItem {
  id: SectionId;
  label: string;
  icon: typeof Server;
}

const NAV_ITEMS: NavItem[] = [
  { id: "models", label: "Models", icon: Server },
  { id: "providers", label: "Providers", icon: Puzzle },
];

export default function SettingsPage({ onClose }: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SectionId>("models");

  const renderSection = () => {
    switch (activeSection) {
      case "providers":
        return <ProvidersSection />;
      case "models":
      default:
        return <ModelsSection />;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100]" onClick={onClose}>
      <div
        className="w-full max-w-4xl h-[80vh] glass-hi rounded-2xl overflow-hidden animate-scale-in flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-bee-border/50 flex-shrink-0">
          <span className="text-sm font-semibold text-bee-text">Settings</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="px-2.5 py-1 rounded-lg text-[10px] bg-bee-gold/10 border border-bee-gold/20 text-bee-goldHi hover:bg-bee-gold/20 transition-colors"
              title="Reload the app window"
            >
              Reload
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textMuted hover:text-bee-text transition-colors ml-2"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          <nav className="w-[220px] flex-shrink-0 border-r border-bee-border/50 overflow-y-auto p-2">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors text-left ${
                    activeSection === item.id
                      ? "bg-bee-gold/10 text-bee-goldHi border border-bee-gold/20"
                      : "text-bee-textDim hover:text-bee-text hover:bg-bee-border/40"
                  }`}
                >
                  <Icon size={14} className="flex-shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex-1 overflow-y-auto p-5">
            {renderSection()}
          </div>
        </div>
      </div>
    </div>
  );
}
