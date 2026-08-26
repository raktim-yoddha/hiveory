# Runtime Replacement Map

| Reference-era dependency class | Target direction | Boundary |
| --- | --- | --- |
| Electron desktop/main process | Tauri 2 + Rust host | host authority and capability configuration |
| Node renderer tooling | React/Vite at build time only | no end-user Node runtime |
| Python agent loop and services | Rust domain/runtime crates | explicit protocol and task lifecycle |
| Node native PTY | Rust portable terminal layer / platform APIs | host-only process authority |
| Node/Bun database adapters | Rust SQLite layer | migrations, receipts, recovery |
| JavaScript provider CLIs | Rust adapter boundary plus explicitly installed local executable when needed | no renderer process launch |
| Browser remote preview | capability-free auxiliary view | isolated from privileged host commands |

This map is architectural guidance. Exact crates and operating-system mechanisms need a dedicated ADR before a capability is enabled.
