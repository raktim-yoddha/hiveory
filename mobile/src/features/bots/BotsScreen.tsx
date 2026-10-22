import { useState } from "react";
import { router, Stack } from "expo-router";
import {
  Bot,
  CalendarClock,
  Crown,
  Plus,
  Users,
  Zap,
} from "lucide-react-native";
import { useCall } from "@/core/api";
import { routes } from "@/core/routes";
import { useTheme } from "@/core/theme";
import {
  Button,
  EmptyState,
  IconButton,
  ListRow,
  Loading,
  Screen,
  Section,
  StatusDot,
} from "@/core/ui";
import { Approvals } from "./Approvals";

/**
 * Bots on the phone (ADR 0039): every bot, Chiefs first, with whether it is working; tap for its threads.
 * Above them, bot calls waiting for a yes, and the way to the computer's Schedules (ADR 0052).
 */
export function BotsScreen() {
  const { colors } = useTheme();
  const bots = useCall("bots.list", undefined);
  const [refreshing, setRefreshing] = useState(false);

  const header = (
    <Stack.Screen
      options={{
        headerRight: () => (
          <IconButton
            label="New bot"
            icon={Plus}
            onPress={() => router.push(routes.botEdit())}
          />
        ),
      }}
    />
  );

  if (bots.isLoading) return <Loading label="Loading bots…" />;
  const list = [...(bots.data ?? [])].sort(
    (a, b) => Number(b.chief) - Number(a.chief) || a.name.localeCompare(b.name),
  );
  if (!list.length) {
    return (
      <>
        {header}
        <EmptyState
          icon={Bot}
          title="No bots yet"
          body="A bot keeps its own threads, schedules and team."
          action={
            <Button
              label="New bot"
              icon={Plus}
              variant="primary"
              onPress={() => router.push(routes.botEdit())}
            />
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <Screen
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void bots.refetch().finally(() => setRefreshing(false));
        }}
      >
        <Approvals />
        <Section>
          <ListRow
            title="Schedules"
            subtitle="Work that runs on its own at set times"
            leading={<CalendarClock size={18} color={colors.textMuted} />}
            onPress={() => router.push(routes.schedules)}
          />
          <ListRow
            title="Triggers"
            subtitle="Bots that act when something happens in your apps"
            leading={<Zap size={18} color={colors.textMuted} />}
            onPress={() => router.push(routes.triggers)}
          />
          <ListRow
            title="Teams"
            subtitle="Groups of bots, each with a Chief of Staff"
            leading={<Users size={18} color={colors.textMuted} />}
            onPress={() => router.push(routes.teams)}
          />
        </Section>
        <Section>
          {list.map((b) => (
            <ListRow
              key={b.id}
              title={b.name}
              subtitle={
                b.blurb ??
                `${b.threads} ${b.threads === 1 ? "thread" : "threads"}`
              }
              label={`${b.name}${b.chief ? ", Chief of Staff" : ""}${b.running ? ", working" : ""}`}
              leading={
                b.chief ? (
                  <Crown size={18} color={colors.brand} />
                ) : (
                  <Bot size={18} color={colors.textMuted} />
                )
              }
              trailing={b.running ? <StatusDot status="working" /> : null}
              onPress={() => router.push(routes.bot(b.id))}
            />
          ))}
        </Section>
      </Screen>
    </>
  );
}
