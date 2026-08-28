# Code Workspace Fidelity Architecture

## Boundary model

```text
React Code shell
  ├─ one navigation rail
  ├─ bounded pane canvas
  └─ pane projections
       ├─ xterm terminal
       ├─ sandboxed local preview
       └─ workspace thread

Tauri host
  ├─ workspace capability checks
  ├─ optimistic layout mutations
  └─ terminal snapshot and event commands

Rust services
  ├─ layout domain: tree invariants and placement
  ├─ runtime: PTY lifecycle and bounded scrollback
  └─ persistence: workspace layouts and terminal summaries
```

## Layout lifecycle

1. The renderer loads a workspace detail snapshot.
2. The host returns the persisted layout or a validated single empty leaf.
3. A pane mutation includes the layout revision it observed.
4. The domain validates the binary tree, leaf count, title, placement, and ratio bounds.
5. Persistence commits the new revision atomically.
6. A conflict causes the renderer to reload the workspace rather than guessing.

The renderer does not invent pane topology. It only dispatches user intent and renders the host-authoritative result.

## Terminal lifecycle

1. A trusted workspace requests a structured shell or adapter launch.
2. The runtime starts a PTY in the approved workspace root.
3. The first event is sequence `1`; output, errors, and exit events increment the same counter.
4. Output is appended to a 1 MiB ring buffer and broadcast to live subscribers.
5. A pane subscribes and loads a snapshot. Events received during that race are held until the snapshot is painted.
6. A sequence gap triggers a full snapshot reload, which repairs a lagged or remounted pane without restarting the process.
7. Input is encoded as UTF-8 base64 in the renderer and decoded only at the runtime boundary.

## Interaction contract

| Interaction | Host operation | Safety behavior |
| --- | --- | --- |
| Split | `split` mutation | Rejects internal nodes and the pane-count limit |
| Move | `move` mutation | Accepts edge docking or center swap; validates both leaves |
| Resize | `resize` mutation | Clamps split ratios to 10–90% |
| Rename | `rename` mutation | Rejects empty, control-character, or oversized titles |
| Maximize | `maximize` mutation | Only leaf panes can be maximized |
| Close | `close_code_pane` | Requires confirmation when a process is running |
| Launch | structured terminal command | Requires trusted workspace execution capability |

## Failure visibility

Transport errors are rendered in the affected pane or workspace banner. A missing in-memory process is treated as a relaunchable stale resource, not as an empty terminal. This distinction is important for restart recovery and makes failures actionable instead of silently blank.

