# Overlap and Ownership Matrix

| Concern | Agent reference | Code reference | Conversation reference | Canonical target owner | Phase 1 result |
| --- | --- | --- | --- | --- | --- |
| Conversations and run history | session runs | coding sessions | conversation/event records | chat domain + persistence | owned |
| Provider/model access | agent model calls | coding providers | provider drivers | model gateway | owned |
| Tool/process execution | agent tools | terminal/process layer | host runtime | tool runtime / code runtime | owned |
| Approval and audit | tool approval | workspace trust | command receipt | security + persistence | owned |
| Extension behavior | skills/plugins | provider adapters | drivers | extension registry | owned |
| Project/worktree state | indirect | primary | attachment links | code domain | owned |
| Persistent events | sessions | recovery state | primary event concepts | persistence | owned |
| Renderer state | desktop projection | primary UI | client projection | renderer only | owned |

There is no unresolved selected-feature ownership conflict. Deferred capabilities must repeat this matrix update before implementation.
