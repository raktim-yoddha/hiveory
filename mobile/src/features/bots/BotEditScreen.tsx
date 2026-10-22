import { useState } from "react";
import { router, Stack } from "expo-router";
import { Check, Trash2 } from "lucide-react-native";
import { APPROVAL_LEVELS, type ApprovalLevel } from "@shared/domain/approval";
import { MAX_BOT_BLURB, MAX_BOT_BRIEF, MAX_BOT_NAME } from "@shared/domain/bot";
import { useAction, useCall, useCliIcons } from "@/core/api";
import { routes } from "@/core/routes";
import { useTheme } from "@/core/theme";
import {
  Button,
  CliLogo,
  confirm,
  ListRow,
  Loading,
  Screen,
  Section,
  Segmented,
  SwitchRow,
  TextField,
} from "@/core/ui";

const APPROVAL_LABEL: Record<ApprovalLevel, string> = {
  changes: "Changes",
  sends: "Sends",
  never: "Never",
};
const APPROVAL_HINT: Record<ApprovalLevel, string> = {
  changes: "Asks before anything that changes or sends in your apps.",
  sends: "Asks before it sends or posts as you.",
  never: "Never asks.",
};

interface Draft {
  name: string;
  blurb: string;
  brief: string;
  cliId: string;
  teamId?: string;
  autoApprove: boolean;
  routines: boolean;
  notify: boolean;
  messaging: boolean;
  approvals: ApprovalLevel;
}

const EMPTY: Draft = {
  name: "",
  blurb: "",
  brief: "",
  cliId: "",
  autoApprove: false,
  routines: false,
  notify: true,
  messaging: true,
  approvals: "sends",
};

/**
 * A bot made or edited from the phone (ADR 0053): its name, what it is for, its brief, the CLI it
 * runs on, its team, and what it may do. Its own computer, memory and model are set on the computer.
 */
export function BotEditScreen({ botId }: { botId?: string }) {
  const { colors } = useTheme();
  const bots = useCall("bots.list", undefined);
  const teams = useCall("teams.list", undefined);
  const engines = useCall("chat.clis", undefined);
  const names = useCall("clis.list", undefined, { staleTime: 10 * 60_000 });
  const icons = useCliIcons();
  const create = useAction("bots.create");
  const update = useAction("bots.update");
  const remove = useAction("bots.delete");
  const bot = botId ? bots.data?.find((b) => b.id === botId) : undefined;
  const [draft, setDraft] = useState<Draft | null>(botId ? null : EMPTY);

  // The bot's own values once it has loaded (set while rendering, not in an effect).
  if (bot && !draft) {
    setDraft({
      name: bot.name,
      blurb: bot.blurb ?? "",
      brief: bot.brief,
      cliId: bot.cliId ?? "",
      teamId: bot.teamId,
      autoApprove: bot.autoApprove,
      routines: bot.routines,
      notify: bot.notify,
      messaging: bot.messaging,
      approvals: bot.approvals,
    });
  }

  if (!draft) return <Loading />;
  const set = (patch: Partial<Draft>): void => setDraft({ ...draft, ...patch });
  const fields = {
    blurb: draft.blurb,
    brief: draft.brief,
    cliId: draft.cliId,
    autoApprove: draft.autoApprove,
    routines: draft.routines,
    notify: draft.notify,
    messaging: draft.messaging,
    approvals: draft.approvals,
    ...(draft.teamId ? { teamId: draft.teamId } : {}),
  };
  const save = (): void => {
    if (botId)
      update.mutate(
        { botId, name: draft.name.trim(), ...fields },
        { onSuccess: () => router.back() },
      );
    else
      create.mutate(
        { name: draft.name.trim(), ...fields },
        { onSuccess: (made) => router.replace(routes.bot(made.id)) },
      );
  };

  return (
    <>
      <Stack.Screen
        options={{ title: botId ? `Edit ${bot?.name ?? "bot"}` : "New bot" }}
      />
      <Screen>
        <Section>
          <TextField
            label="Name"
            value={draft.name}
            onChangeText={(name) => set({ name })}
            maxLength={MAX_BOT_NAME}
          />
          <TextField
            label="What it is for"
            placeholder="One line"
            value={draft.blurb}
            onChangeText={(blurb) => set({ blurb })}
            maxLength={MAX_BOT_BLURB}
          />
          <TextField
            label="Brief"
            placeholder="What it owns, the standards it keeps, when it stops to ask"
            value={draft.brief}
            onChangeText={(brief) => set({ brief })}
            maxLength={MAX_BOT_BRIEF}
            multiline
          />
        </Section>
        <Section title="Runs on">
          <ListRow
            title="The default CLI"
            trailing={
              !draft.cliId ? <Check size={18} color={colors.accent} /> : null
            }
            onPress={() => set({ cliId: "" })}
          />
          {(engines.data ?? []).map((id) => (
            <ListRow
              key={id}
              title={names.data?.find((c) => c.id === id)?.displayName ?? id}
              leading={<CliLogo icon={icons.get(id)} size={24} />}
              trailing={
                draft.cliId === id ? (
                  <Check size={18} color={colors.accent} />
                ) : null
              }
              onPress={() => set({ cliId: id })}
            />
          ))}
        </Section>
        {teams.data && teams.data.length > 1 ? (
          <Section title="Team">
            {teams.data.map((t) => (
              <ListRow
                key={t.id}
                title={t.name}
                trailing={
                  draft.teamId === t.id ? (
                    <Check size={18} color={colors.accent} />
                  ) : null
                }
                onPress={() => set({ teamId: t.id })}
              />
            ))}
          </Section>
        ) : null}
        <Section title="What it may do">
          <SwitchRow
            label="Full access"
            hint="Edits files and runs commands; off is read-only."
            value={draft.autoApprove}
            onChange={(autoApprove) => set({ autoApprove })}
          />
          <SwitchRow
            label="Run on a schedule"
            value={draft.routines}
            onChange={(routines) => set({ routines })}
          />
          <SwitchRow
            label="Talk to other bots"
            value={draft.messaging}
            onChange={(messaging) => set({ messaging })}
          />
          <SwitchRow
            label="Notify me"
            hint="When it replies or a schedule of its ends."
            value={draft.notify}
            onChange={(notify) => set({ notify })}
          />
          <Segmented
            label="Ask before acting in apps"
            value={draft.approvals}
            onChange={(approvals) => set({ approvals })}
            options={APPROVAL_LEVELS.map((level) => ({
              value: level,
              label: APPROVAL_LABEL[level],
            }))}
          />
          <ListRow title={APPROVAL_HINT[draft.approvals]} />
        </Section>
        <Button
          label={botId ? "Save" : "Create bot"}
          variant="primary"
          block
          disabled={!draft.name.trim()}
          loading={create.isPending || update.isPending}
          onPress={save}
        />
        {botId ? (
          <Button
            label="Delete bot"
            icon={Trash2}
            variant="danger"
            block
            onPress={() =>
              confirm(
                `Delete ${bot?.name ?? "this bot"}?`,
                "Its threads go too. Files it made stay on the computer.",
                "Delete",
                () =>
                  remove.mutate(
                    { botId },
                    { onSuccess: () => router.replace(routes.bots) },
                  ),
              )
            }
          />
        ) : null}
      </Screen>
    </>
  );
}
