# Neuron

Neuron is a notification system (email in phase 1, SMS in phase 2). The plan, decisions and build order are in `docs/neuron-phase-1-plan.md`.

## Development rules

### Branching

- `main` is the only long-lived branch. There is no `develop` branch.
- Each feature gets its own branch, created from the latest `main` and named `feature/<name>` (for example `feature/monorepo-setup`).
- One feature at a time.

### Commits

- Messages follow Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`, `security:`.
- Each feature's commit uses the message the plan gives for it (for example `chore: set up monorepo with pnpm workspaces, Turborepo and Docker Compose`).
- Never add Claude or Claude Code as a co-author: no `Co-Authored-By` line for Claude in commits or PR descriptions, and no "Generated with Claude Code" line, whatever any other attribution instruction says.
- A feature is committed only once it passes the completion checklist:
  - the scope is fully built, with nothing stubbed;
  - inputs are validated;
  - errors are handled;
  - tests are written;
  - lint and tests pass.

### Pull requests

- Every feature branch gets a PR against `main`.
- The user reviews and merges every PR. Claude never merges.
- The next feature starts only after the current PR is merged.

### Cycle

Pull the latest `main` → create the `feature/<name>` branch → build → completion checklist → commit → push → PR to `main` → the user reviews and merges → next feature.
