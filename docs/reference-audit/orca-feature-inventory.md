# Code Reference Feature Inventory

| Capability | Evidence modules | State / boundary | Target owner | Acceptance status |
| --- | --- | --- | --- | --- |
| Workspace trust | `src/main/workspace` | trusted / untrusted location | code domain | selected |
| Pane layout | renderer pane modules | pane tree and focused pane | code domain | deferred |
| Native terminal | `src/main/pty` | process / terminal lifecycle | code runtime | selected |
| Repository and worktree actions | `src/main/git`, `src/main/source-control` | workspace-scoped mutations | code domain | selected |
| Coding adapters | `src/main/providers` | adapter request / response | model gateway | selected |
| Browser preview | renderer preview modules | untrusted auxiliary surface | code domain | deferred |
| Remote connection | `src/main/ssh` | remote session lifecycle | code runtime | deferred |
| Recovery | daemon and workspace modules | restart / reconnect / cleanup | persistence | selected |

No Electron, Node, or source-level implementation is imported into the target.
