# Agent Reference Feature Inventory

Status reflects behavior research, not code-porting. Exact evidence paths remain inside the read-only reference checkout.

| Capability | Evidence modules | State / boundary | Target owner | Acceptance status |
| --- | --- | --- | --- | --- |
| Named work profiles | `agent`, `apps/desktop` | profile selection and settings | agent domain | selected |
| Run lifecycle and streaming | `agent`, `gateway` | run → tool call → result → completion | agent runtime | selected |
| Tool approval | `tools`, desktop IPC | pending / approved / denied | tool runtime | selected |
| Skills and routines | `skills`, `plugins` | discover / enable / invoke | agent domain | selected |
| Memory providers | `memory`, `plugins` | scoped recall and write | agent domain | selected / implemented |
| Scheduled routines | `cron` | scheduled / executing / failed | agent runtime | selected / implemented |
| Delegated work | `agent` | parent / child run relationship | agent runtime | selected / implemented |
| Session persistence | `agent`, storage adapters | resume and recovery | persistence | selected |

The target will reproduce selected user-visible behavior through original Rust modules and tests only.
