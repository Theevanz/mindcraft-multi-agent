# Baseline record

- Baseline = committed HEAD `25c5ba7`, restored `2026-11-21` before the lab
  session. `git status` of tracked files is clean at handoff; all prior
  workstream changes (C1–C35 + 11-21 park/pos/restore fixes) are preserved in
  `experiments/baseline-backup/` and re-applied per `STRATEGIES.md` steps.
- Untracked files NOT touched by the revert: `experiments/` itself,
  `FINDINGS.md`, `bots/` logs/histories, `profiles/defaults/_default.json.bak`.
- Next session: run T0 at a fresh north site (shift `coordinates[2]` −30 from
  HEAD's `(12, y, 29)`), score with `experiments/tools/analyze_runs.py`.

## Revert procedure used (for the record)

1. `git diff > experiments/baseline-backup/working-tree-2026-11-21.patch`
   (+ `.stat`), untracked session files copied beside it.
2. `git stash push -m "pre-lab working tree 2026-11-21"` (tracked only —
   `experiments/` stays in place).
3. Verified: `git status --short` shows no ` M` entries; L0 coords back at
   HEAD values; `node --check` on touched entry points.
