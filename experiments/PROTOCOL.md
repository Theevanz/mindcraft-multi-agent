# Tuning protocol: local bots on `church_two_agent`

Goal: Andy-4 micro + Gemma 12B (no thinking, 16 GB Mac Mini) build the 15-level
church by hand — normal players, zero slash commands. Budget: 20 runs, stop
early on 15/15. Source of truth for the loop; survives across runs.

## Roles

- **User launches.** Muse's sandbox cannot reach the MC server (`openmediavault`
  unresolvable, direct TCP refused), so the user fires one command per run and
  says "done". That is the only step outside Muse's reach.
- **Muse does everything else:** pre-run guards, scoring, diagnosis, one
  strategy edit, north move, master log.

## The 7 steps (per iteration)

1. **Baseline.** One variable at a time. Current code state + site coords are the
   baseline; `git diff --stat` recorded in the run record before any edit.
2. **Propose.** One simple change, or two strapped together max. Taken from
   `STRATEGIES.md` queue order. Never re-test a FAILED item except at its
   listed priority.
3. **Fresh site.** Shift every level's `coordinates[2]` north (-Z) by 30 in
   `tasks/construction_tasks/custom/church_two_agents.json`. Restarts resume,
   so a fresh site is the only clean comparison.
4. **Run + log.** User runs:
   `node main.js --profiles ./profiles/andy1.json ./profiles/andy2.json --task_path tasks/construction_tasks/custom/church_two_agents.json --task_id church_two_agent`
   Console → `experiments/runs/<n>.console.log` (gitignored). Muse never reads
   the console raw — evaluation is the scorecard below (~15 lines/run).
5. **Evaluate: run issue or strategy issue?** Same-coords re-run once on
   ambiguous stalls. Same failure signature = strategy issue; different =
   run issue (bot died, travel failed, stale process). Pre-run guards: no
   stale `node main.js`, both bots join, both `pos` values at the new site
   within the first minute.
6. **Run issue → re-run** with new coords. Strategy issue → step 7.
7. **Record + repeat.** Append `experiments/runs/<n>.md` (template below),
   update `STRATEGIES.md` verdicts, go to step 1.

## Score (every run)

`python3 experiments/tools/analyze_runs.py` — passes, placed/failed/occupied,
levels done, redirects/escalations, failure reasons, model-vs-truth memory.
Peak check: `grep -h "Level [0-9]* complete" bots/andy*/histories/*.json`.

## Rules

- One variable per iteration; revert to baseline between strategies if effects
  smear (`git checkout -- <file>` for single files, full `git stash -u` only
  with user go-ahead).
- Never strip chat/history/logs. Never use build slash-commands (user
  constraint: normal player, not admin).
- Probe with mocks (`experiments/tools/blueprint_probe.mjs`, `index.js`
  imported first — ESM cycle) before claiming a change works.
- Token discipline: scorecard + targeted greps only. Histories are counted by
  script, not read whole.
- No hypertuning: generic mechanisms only (dimensions from blueprint data,
  never hardcoded church constants). Ship criteria: andy pair 15/15 AND muse
  pair still 15/15 (regression gate — muse built it on baseline, must build
  it on the final scaffold).
- Vivid records: each run file attaches the FULL strategy `git diff` (not
  just stat), the exact run command, site coords, scorecard, and a
  mechanism-level observation — recreatable in a fresh session from the
  file alone.

## Run record template (`experiments/runs/<n>.md`)

```markdown
# Run <n> — <date>
Strategy: <T-id from STRATEGIES.md, one line>
Baseline diff stat: <git diff --stat before edit>
Site: <L0 coords> | Code: <git sha + clean/dirty>
Score: <paste analyzer block>
Verdict: <strategy issue | run issue | inconclusive>
Observation: <2-3 lines, mechanism not vibes>
Next: <T-id or re-run>
```
