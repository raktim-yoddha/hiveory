import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, Stack } from "expo-router";
import { FolderOpen, Plus, Server } from "lucide-react-native";
import type { Project } from "@shared/domain/project";
import { useCall, useCalls } from "@/core/api";
import { routes } from "@/core/routes";
import { space, useTheme } from "@/core/theme";
import {
  Button,
  EmptyState,
  IconButton,
  ListRow,
  Loading,
  Screen,
  Section,
  StatusDot,
  Text,
  WorkspaceMark,
} from "@/core/ui";
import { AddWorkspaceSheet } from "./AddWorkspaceSheet";

/** Pinned first, then most recently worked on, like the desktop sidebar (ADR 0060). */
const byWork = (a: Project, b: Project): number =>
  Number(Boolean(b.settings?.pinned)) - Number(Boolean(a.settings?.pinned)) ||
  (b.lastActiveAt ?? b.createdAt).localeCompare(a.lastActiveAt ?? a.createdAt);

/** Every project on the computer, with how many agents need the user or are working in each. */
export function ProjectsScreen() {
  const { colors } = useTheme();
  const projects = useCall("projects.list", undefined);
  const list = useMemo(
    () => [...(projects.data ?? [])].sort(byWork),
    [projects.data],
  );
  const boards = useCalls(
    "kanban.board",
    list.map((p) => ({ projectId: p.id })),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const header = (
    <Stack.Screen
      options={{
        headerRight: () => (
          <IconButton
            label="Add a workspace"
            icon={Plus}
            onPress={() => setAdding(true)}
          />
        ),
      }}
    />
  );
  const sheet = (
    <AddWorkspaceSheet open={adding} onClose={() => setAdding(false)} />
  );

  if (projects.isLoading) return <Loading label="Loading workspaces…" />;
  if (!list.length) {
    return (
      <>
        {header}
        <EmptyState
          icon={FolderOpen}
          title="No workspaces yet"
          body="Add a folder or clone a repository on the computer."
          action={
            <Button
              label="Add a workspace"
              icon={Plus}
              variant="primary"
              onPress={() => setAdding(true)}
            />
          }
        />
        {sheet}
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
          void projects.refetch().finally(() => setRefreshing(false));
        }}
      >
        <Section>
          {list.map((p, i) => {
            const board = boards[i]?.data;
            const waiting = board?.["waiting-for-you"].length ?? 0;
            const working = board?.working.length ?? 0;
            return (
              <ListRow
                key={p.id}
                title={p.name}
                subtitle={p.host ? `On ${p.host.destination}` : p.path}
                label={`${p.name}${waiting ? `, ${waiting} need you` : ""}${working ? `, ${working} working` : ""}`}
                leading={
                  p.host ? (
                    <Server size={18} color={colors.brand} />
                  ) : (
                    <WorkspaceMark project={p} />
                  )
                }
                trailing={
                  <View style={styles.counts}>
                    {waiting ? (
                      <View style={styles.count}>
                        <StatusDot status="waiting-for-you" />
                        <Text variant="label" tone="waiting">
                          {waiting}
                        </Text>
                      </View>
                    ) : null}
                    {working ? (
                      <View style={styles.count}>
                        <StatusDot status="working" />
                        <Text variant="label" tone="working">
                          {working}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                }
                onPress={() => router.push(routes.project(p.id))}
              />
            );
          })}
        </Section>
      </Screen>
      {sheet}
    </>
  );
}

const styles = StyleSheet.create({
  counts: { flexDirection: "row", gap: space[5] },
  count: { flexDirection: "row", alignItems: "center", gap: space[2] },
});
