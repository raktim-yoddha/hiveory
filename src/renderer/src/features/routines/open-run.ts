import type { RoutineTarget } from '@shared/domain/routine'
import { useChat } from '../../stores/chat'
import { useNavigation } from '../../stores/navigation'
import { useRoutineEditor } from './RoutineEditor'

/** A scheduled chat's run (ADR 0030) lives in Chat mode: switch there and open it. */
export function openRunChat(chatId: string): void {
  useNavigation.getState().setMode('chatspace')
  void useChat.getState().open(chatId)
}

/** "Schedule a chat" (Chat): the editor opens right here; Chat never jumps to Bots (ADR 0030, 0046). */
export function scheduleRoutine(target: RoutineTarget): void {
  useRoutineEditor.getState().open({ target })
}

/** "Schedule a routine…" in Work (ADR 0040): the editor opens right here, for that Workspace's worktree. */
export function scheduleWorkRoutine(projectId: string, workspaceId: string): void {
  useRoutineEditor.getState().open({ target: { kind: 'workspace', projectId, workspaceId, cliId: '' } })
}
