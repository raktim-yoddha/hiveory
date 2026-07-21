/** Minimal Open-VSX registry client (https://open-vsx.org/api). */

export interface OpenVsxResult {
  id: string;        // "namespace.name"
  name: string;      // display name
  publisher: string; // namespace
  description?: string;
  icon?: string;     // remote icon URL
  version?: string;
  downloadCount?: number;
}

/** Search the marketplace. Empty query returns popular extensions. */
export async function searchOpenVsx(query: string, size = 24): Promise<OpenVsxResult[]> {
  const q = query.trim();
  const url =
    `https://open-vsx.org/api/-/search?size=${size}&sortBy=${q ? "relevance" : "downloadCount"}` +
    (q ? `&query=${encodeURIComponent(q)}` : "");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-VSX search failed (${res.status})`);
  const data = await res.json();
  return (data.extensions ?? []).map((e: any): OpenVsxResult => ({
    id: `${e.namespace}.${e.name}`,
    name: e.displayName || e.name,
    publisher: e.namespace,
    description: e.description,
    icon: e.files?.icon,
    version: e.version,
    downloadCount: e.downloadCount,
  }));
}
