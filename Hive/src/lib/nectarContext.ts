import { invoke } from "@tauri-apps/api/core";

// Ranked so the highest-signal files get injected first when the budget is tight
// (AGENTS.md §4.2: "truncate by rank, not by file order").
const MEMORY_FILES_PRIORITY = [
  "project.md",
  "decisions.md",
  "conventions.md",
  "bugs.md",
  "patterns.md",
  "architecture.md",
  "knowledge.md",
];

const DEFAULT_BUDGET_CHARS = 3000;

function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes("\\") ? "\\" : "/";
  return [base.replace(/[\\/]+$/, ""), ...parts].join(sep);
}

// A freshly-scaffolded memory file is just its placeholder comment — injecting
// that is noise, not signal. AGENTS.md §4.2.4: "if nothing clears a minimum
// relevance threshold, inject nothing."
function isMeaningful(content: string): boolean {
  const stripped = content.replace(/<!--[\s\S]*?-->/g, "").trim();
  return stripped.length > 0;
}

export interface NectarInjectionSource {
  file: string;
  chars: number;
}

export interface NectarInjection {
  text: string;
  sources: NectarInjectionSource[];
}

// Reads .nectar/memory/*.md (ranked) and assembles a capped context block.
// Returns null when there's nothing meaningful to inject.
export async function buildNectarInjection(
  projectPath: string,
  budgetChars: number = DEFAULT_BUDGET_CHARS,
): Promise<NectarInjection | null> {
  const sources: NectarInjectionSource[] = [];
  const sections: string[] = [];
  let remaining = budgetChars;

  for (const filename of MEMORY_FILES_PRIORITY) {
    if (remaining <= 0) break;
    const relPath = `memory/${filename}`;
    const fullPath = joinPath(projectPath, ".nectar", relPath);

    let content: string;
    try {
      content = await invoke<string>("read_file", { path: fullPath });
    } catch {
      continue;
    }

    if (!isMeaningful(content)) continue;

    const trimmed = content.trim();
    const slice = trimmed.slice(0, remaining);
    sections.push(`### ${relPath}\n${slice}`);
    sources.push({ file: relPath, chars: slice.length });
    remaining -= slice.length;
  }

  if (sections.length === 0) return null;

  const text = [
    "[Hiveory Nectar — project memory auto-injected, ranked & truncated]",
    ...sections,
    "[end of injected context]",
  ].join("\n\n");

  return { text, sources };
}

// AGENTS.md §4.2.5: "Every injection is logged... write which chunks were
// retrieved... to agents/sessions/<timestamp>.md."
export async function logNectarInjection(
  projectPath: string,
  paneId: string,
  cli: string,
  injection: NectarInjection,
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = joinPath(
    projectPath,
    ".nectar",
    "agents",
    "sessions",
    `${timestamp}-${paneId}.md`,
  );

  const sourceLines = injection.sources
    .map((s) => `- ${s.file} (${s.chars} chars)`)
    .join("\n");

  const content = [
    `# Session: ${cli}`,
    ``,
    `Pane: ${paneId}`,
    `Time: ${new Date().toISOString()}`,
    ``,
    `## Injected context sources`,
    ``,
    sourceLines,
    ``,
    `## Injected text`,
    ``,
    "```",
    injection.text,
    "```",
    ``,
  ].join("\n");

  try {
    await invoke("write_file", { path: logPath, content });
  } catch (e) {
    console.error("Failed to log Nectar injection:", e);
  }
}
