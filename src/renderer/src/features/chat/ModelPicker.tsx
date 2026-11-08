import { useEffect, useMemo, useState } from "react";
import { ChevronDown, RefreshCw, Search } from "lucide-react";
import type { ChatModel } from "@shared/domain/chat";
import { CliLogo } from "../../components/cli/CliLogo";
import { IconButton } from "../../components/ui/Button";
import { Popover } from "../../components/ui/Popover";
import { cx } from "../../lib/cx";
import { useChat } from "../../stores/chat";
import { useClis } from "../../stores/data";
import styles from "./Chat.module.css";
import composer from "./Composer.module.css";

const MAX_VISIBLE_MODELS = 250;
const matches = (m: ChatModel, q: string): boolean =>
  `${m.label} ${m.id} ${m.group ?? ""}`.toLowerCase().includes(q);

interface ModelPickerProps {
  /** The chat's CLI and model now. */
  cliId: string;
  model: string;
  /** Lists every chat CLI (Chat's own picker); else only the chat's CLI. */
  switchable: boolean;
  /** True once the chat has messages: another CLI takes the conversation over (ADR 0058). */
  started: boolean;
  onChange(cliId: string, model: ChatModel): void;
}

/**
 * The CLI and its model in one control (ADR 0058): the CLIs down the left, the chosen one's models on the right,
 * searchable and grouped (OpenCode lists hundreds). Picking a model of another CLI switches both.
 */
export function ModelPicker({
  cliId,
  model,
  switchable,
  started,
  onChange,
}: ModelPickerProps) {
  const { catalogs, loadCatalog, clis: chatClis } = useChat();
  const clis = useClis((s) => s.clis);
  const current = catalogs[cliId];
  const currentModel =
    current && current !== "loading"
      ? current.models.find((m) => m.id === model)
      : undefined;
  const cliName = (id: string): string =>
    clis.find((c) => c.id === id)?.displayName ?? id;
  const loading = current === "loading";

  return (
    <Popover
      label="Choose CLI and model"
      placement="above"
      width={switchable ? "xl" : "lg"}
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className={cx(styles.pill, styles.pillModel)}
          title={`${cliName(cliId)} · ${currentModel?.id || "default model"}`}
        >
          <CliLogo cliId={cliId} size="sm" />
          <span className={styles.pillText}>
            {loading
              ? "Loading models…"
              : (currentModel?.label ?? "Default model")}
          </span>
          <ChevronDown aria-hidden className={styles.chevron} />
        </button>
      )}
    >
      {(close) => (
        <PickerBody
          cliId={cliId}
          model={model}
          clis={switchable ? (chatClis.length ? chatClis : [cliId]) : [cliId]}
          cliName={cliName}
          started={started}
          catalogs={catalogs}
          loadCatalog={loadCatalog}
          onPick={(id, m) => {
            onChange(id, m);
            close();
          }}
        />
      )}
    </Popover>
  );
}

interface PickerBodyProps {
  cliId: string;
  model: string;
  clis: string[];
  cliName(id: string): string;
  started: boolean;
  catalogs: ReturnType<typeof useChat.getState>["catalogs"];
  loadCatalog(cliId: string, refresh?: boolean): Promise<void>;
  onPick(cliId: string, model: ChatModel): void;
}

function PickerBody({
  cliId,
  model,
  clis,
  cliName,
  started,
  catalogs,
  loadCatalog,
  onPick,
}: PickerBodyProps) {
  const [tab, setTab] = useState(cliId);
  const [query, setQuery] = useState("");
  const catalog = catalogs[tab];
  const models = useMemo(
    () => (catalog && catalog !== "loading" ? catalog.models : []),
    [catalog],
  );

  // A CLI's models are asked for only when its tab is opened.
  useEffect(() => {
    void loadCatalog(tab);
  }, [tab, loadCatalog]);

  const q = query.trim().toLowerCase();
  const found = useMemo(
    () => (q ? models.filter((m) => matches(m, q)) : models),
    [models, q],
  );
  const groups = useMemo(() => {
    const map = new Map<string, ChatModel[]>();
    for (const m of found.slice(0, MAX_VISIBLE_MODELS))
      map.set(m.group ?? "", [...(map.get(m.group ?? "") ?? []), m]);
    return [...map];
  }, [found]);

  return (
    <div className={composer.picker}>
      {clis.length > 1 && (
        <div
          className={composer.cliTabs}
          role="tablist"
          aria-label="CLIs"
          aria-orientation="vertical"
        >
          {clis.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={id === tab}
              className={cx(
                composer.cliTab,
                id === tab && composer.cliTabActive,
              )}
              onClick={() => setTab(id)}
              title={cliName(id)}
            >
              <CliLogo cliId={id} size="sm" />
              <span className={composer.cliTabName}>{cliName(id)}</span>
            </button>
          ))}
        </div>
      )}
      <div className={styles.models}>
        <div className={styles.modelSearch}>
          <Search aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${models.length} models`}
            aria-label="Search models"
          />
          <IconButton
            label="Refresh models"
            icon={<RefreshCw />}
            onClick={() => void loadCatalog(tab, true)}
          />
        </div>
        {tab !== cliId && started && (
          <p className={styles.modelNote}>
            {cliName(tab)} takes the conversation over from here, with what was
            said so far.
          </p>
        )}
        {catalog && catalog !== "loading" && catalog.error && (
          <p className={styles.modelNote}>
            {catalog.error} The default model still works.
          </p>
        )}
        <div
          className={styles.modelList}
          role="listbox"
          aria-label={`${cliName(tab)} models`}
        >
          {catalog === "loading" || !catalog ? (
            <p className={styles.modelNote}>Loading models…</p>
          ) : null}
          {groups.map(([group, list]) => (
            <div key={group || "default"}>
              {group && <div className={styles.modelGroup}>{group}</div>}
              {list.map((m) => {
                const selected = tab === cliId && m.id === model;
                return (
                  <button
                    key={m.id || "default"}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={cx(
                      styles.modelOption,
                      selected && styles.modelSelected,
                    )}
                    onClick={() => onPick(tab, m)}
                  >
                    <span className={styles.modelText}>
                      <span className={styles.modelLabel}>{m.label}</span>
                      <span className={styles.modelId}>
                        {m.description ?? m.id}
                      </span>
                    </span>
                    {m.efforts && m.efforts.length > 0 && (
                      <span className={styles.modelBadge}>effort</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {catalog && catalog !== "loading" && found.length === 0 && (
            <p className={styles.modelNote}>No models match “{query}”.</p>
          )}
          {found.length > MAX_VISIBLE_MODELS && (
            <p className={styles.modelNote}>
              Showing {MAX_VISIBLE_MODELS} of {found.length} — refine your
              search.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
