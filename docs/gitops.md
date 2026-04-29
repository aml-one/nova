# GitOps for Autonomous Changes

## Goals
- Every autonomous code/skill change is attributable.
- Changes can be checkpointed and rolled back rapidly.

## Baseline Policy
- Agent writes to `agent/auto/*` branches.
- Protected branches are not pushed directly.
- Checkpoint tags are created only after validation gates pass.

## Rollback
- Roll back to the last known-good checkpoint when post-change checks fail.
- `GitOpsManager.rollbackToCheckpoint("latest")` rolls back to the most recent checkpoint tag.

## Required Environment
- Repository must be initialized with Git and have an `origin` remote.
- Token/credentials must allow branch push + tag push.
