# Code orchestration and skill boundary

Code orchestration is a Code-mode run/task scheduler, not Hiveory Agent execution and not the Skills catalog. Its source owner is `src/crates/modes/code/hiveory-code-orchestration/src/`; lifecycle and trust details live in [Code orchestration architecture](../../../architecture/code-orchestration.md) and [coordination boundary](../../../architecture/app-control-plane.md).

The Dev/private Agent runtime is separate. Do not imply Code workers load local Skills packages unless a current source path proves that behavior. See [Skills status](README.md) and [private Dev boundary](../../../architecture/private-feature-boundary.md).
