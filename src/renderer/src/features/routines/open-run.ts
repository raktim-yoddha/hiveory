import type { RoutineTarget } from '@shared/domain/routine'
import { useBots } from '../../stores/bots'
import { useChat } from '../../stores/chat'
import { useNavigation } from '../../stores/navigation'
import { useRoutineEditor } from './RoutineEditor'

/** A scheduled chat's run (ADR 0030) lives in Chat mode: switch there and open it. */
export function openRunChat(chatId: string): void {
  useNavigation.getState().setMode('chatspace')
  void useChat.getState().open(chatId)
}

/** "Schedule a chat" (Chat): the Routines page with the editor open on that target. */
export function scheduleRoutine(target: RoutineTarget): void {
  useNavigation.getState().setMode('bots')
  useBots.getState().showRoutines()
  useRoutineEditor.getState().open({ target })
}

/** "Schedule a routine…" in Work (ADR 0040): the editor opens right here, for that Workspace's worktree. */
export function scheduleWorkRoutine(projectId: string, workspaceId: string): void {
  useRoutineEditor.getState().open({ target: { kind: 'workspace', projectId, workspaceId, cliId: '' } })
}
