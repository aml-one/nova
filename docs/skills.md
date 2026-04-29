# Skills Guide

## Skill Shape
- `manifest`: identity, permissions, and versioning metadata.
- `run(input, context)`: async execution entry point.
- `permissions`: enforced by skill runtime before execution.

## Where Skills Live
- Workspace package under `skills/<skill-name>/`.
- Shared runtime APIs in `packages/skills`.

## Example
- `skills/camera-vision` captures RTSP snapshot/clip and returns object detections.
- `skills/example-shell-skill` demonstrates shell capability wiring.

## Permission Categories
- `filesystem`
- `network`
- `shell`
- `camera`
