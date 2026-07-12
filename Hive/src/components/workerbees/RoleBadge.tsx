"use client";

export interface RoleBadgeProps {
  role: string;
  branchName?: string;
}

const ROLE_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  builder: { label: 'Builder', color: 'bg-bee-gold/15 text-bee-goldHi border-bee-gold/25', dot: 'bg-bee-gold shadow-glow' },
  reviewer: { label: 'Reviewer', color: 'bg-blue-500/10 text-blue-300 border-blue-400/20', dot: 'bg-blue-400' },
  scout: { label: 'Scout', color: 'bg-purple-500/10 text-purple-300 border-purple-400/20', dot: 'bg-purple-400' },
  coordinator: { label: 'Coordinator', color: 'bg-red-500/10 text-red-300 border-red-400/20', dot: 'bg-red-400' },
};

const CACHE: Record<string, { label: string; color: string; dot: string }> = { ...ROLE_CONFIG };

function configForRole(role: string) {
  const lower = role.toLowerCase();
  return CACHE[lower] || { label: role, color: 'bg-bee-textMuted/10 text-bee-textDim border-bee-textMuted/20', dot: 'bg-bee-textMuted' };
}

export default function RoleBadge({ role, branchName }: RoleBadgeProps) {
  const cfg = configForRole(role);

  return (
    <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium border ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      <span>{cfg.label}</span>
      {branchName && (
        <span className="font-mono text-[9px] opacity-60 ml-0.5 truncate max-w-[80px]" title={branchName}>
          {branchName}
        </span>
      )}
    </span>
  );
}
