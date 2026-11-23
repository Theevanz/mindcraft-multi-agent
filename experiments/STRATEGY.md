# Strategy spec — two bots hand-building a blueprint church (distilled from 37 runs)

Status: SHIP MET — true 15/15 by three model families on this scaffold
(andy run 29, muse run 31, gemma run 34, gemma repeats run 37). This doc is
the explainable, reproducible form: the five principles, their exact
mechanisms, the dead ends to skip, and the recipe to rebuild. Evidence lives
in `runs/1.md`–`runs/37.md` and `STRATEGIES.md`; this file replaces none of
it, it compresses it.

## The five principles

**1. Deterministic core, model at the edges.** One engine command plans and
executes everything; the model's only job is to keep calling it. `!newAction`
reroutes to `buildNextBlueprintLevel`: scan all levels, grind the lowest
incomplete one, hand-place every block (`dontCheat`, removals first, doors
once, per-block isolation so one failure never aborts a level), re-verify,
skip levels with zero progress 3+ times. Proof: run 3 took over at 17.6% and
hit 54.9% with a 3-level streak the same day; every 15/15 since rides it.

**2. Never answer small models with errors.** Micro models loop on errors
instead of pivoting (60× statue loop). Distractions redirect to
`!newAction` (dodge 1–2), and the 3rd dodge force-builds (escalation). No
forced bot-to-bot chat (it ate 30-turn loops + an 80-plank giveaway), 9
command docs, static `$MEMORY` status line, temp-0/terse/16k profiles.
Leanness comes from *not generating* noise — chat, history, and logs stay
100% verbatim (user veto, never violated). Proof: run 4 killed all loops
with score flat; muse needed zero redirects without dithering.

**3. Fail honestly and bound everything.** Navigation never digs through the
build (`noDigNavigate`: `canDig`/`canPlaceOn` false — fail instead). Flight
is per-cell (distance ≥10 or gap ≥2 above — 2+ up is unclimbable on foot)
and every walk starts grounded (`landIfFlying` at the top of every goto:
gravity reads 0 only while flying). Every await is bounded with
abandon-not-stop semantics: 30 s nav timeout, 30 s op timeouts (dig aborts
via `stopDigging`), 8 s flight races. NEVER call `pathfinder.stop()` — its
stale flag poisons the next trip (99%→82% in run 8). Re-park idlers outside
the footprint; suppress drift/litter modes at spawn top plus every pass.
Session-level bound: zero placements for 5+ minutes triggers a clean
restart into a fresh session (supervisor resumes; capped at 3 per run) —
desync, embeds, and effect-states cannot wedge a run forever. Proof: run 10
(hangs bounded, 14/15), run 29 (landing added → first true 15/15, timeouts
47→6).

**4. Share the lowest level; divide halves with fallback.** Both bots grind
the same lowest incomplete level — no splits, no waits, no ownership (one
missing bot wedged strict alternation: 120 waits, 0 placements). Within a
level each bot works only its footprint half (midpoint from blueprint data,
never hardcoded) and helps the other half solely when its own is clean;
takeover latency on a dead partner is one pass. Cells blocked by the other
bot count toward the skip rule; regressions log exact coords. Blocking is
body-volume, not center-distance: a feet-to-head column test catches
head-clips the 1.8/1.1 spheres miss (run 35: 15 combined refusals from a
camper 2.0 under the cell), the partner scan runs at radius 8, and
occupancy counts as cell strikes so campers displace instead of squatting.
Proof: run 24 (97.9%, occupancy ~0 across 50 passes); every solo-carry
since (a partner died and the run still shipped) is the failsafe working
as designed.

**5. Validate strictly and instrument everything.** The validator is a
zero-tolerance sum of the same `checkLevel` the engine uses — 100% means
literally zero mismatches (plus `wall_torch` normalization so hand-placed
torches count). Every mechanism emits evidence: `build_pass` / `redirect` /
`regression` / `memory_snapshot` / `park_failed` / `vacated` /
`stall_relog` events with positions, `[bound]` console lines on every
timeout trip (carrying target, distance, block-below, feet block, effects,
velocity, vehicle, gravity, on-ground), last-face errors on placement
failures. Proof: run 6 (validation fix → 99.1%), run 28 (telemetry
exonerated an apparent freeze — both bots were grinding, not hung).
Known artifact: the validator interval can fire mid-pass, so a missing
`Level N complete` print beside 100% is a logging race, not a gap
(run 11's old "one short" claim is suspect for exactly this reason).

## Buildable mechanism checklist (logical order, not history order)

Apply to clean HEAD in this order; probe each with mocks before running
(see run records for probe patterns — unit first, then full-path through
`!newAction`, then a live gate run):

1. **Goal plumbing** (`tasks.js` `getAgentGoal`, `construction_tasks.js`
   `explain`): SOP-first goal carrying site + `name: count` materials.
2. **Engine** (`actions.js`): `hasBlueprintBuild` gate, `!newAction`
   reroute, `!buildBlueprintLevel`, `buildNextBlueprintLevel`,
   `buildLevelFixes` (per §1), `checkLevel` partial-results (never `false`).
3. **Guardrails** (`actions.js`, `index.js`, `prompter.js`, profiles):
   `blueprintRedirect` + escalation, no forced `!startConversation` on
   builds, distractor-command redirects, 9-doc blueprint subset, static
   `$MEMORY` line, temp-0/16k profiles (terse `num_predict` for micro
   models only — capable models self-regulate; gemma runs uncapped).
4. **Movement** (`skills.js`, `actions.js`): `noDigNavigate` branch,
   per-cell `flyNearIfNeeded` (gap≥2), `landIfFlying` in `gotoBounded`,
   `parkAwayFromSite` on idle, four mode-offs at spawn top + per pass,
   no-wipe resume (restarts continue, never reset).
5. **Bounds** (`skills.js`, `actions.js`): `gotoBounded`/`opBounded` 30 s
   abandon + warn, 8 s flight races, `ejectIfTooClose` as walk-failure
   fallback only (walk first — eject-first stranded run 27 all run),
   `stallCheck` re-log failsafe (zero placements 5+ min → clean restart,
   cap 3/run; covers build passes AND the all-skipped loop).
6. **Teamwork** (`actions.js`, `skills.js`): `footprintMidX`/
   `biasSplitHalves`, conditional-help rule, occupied-counts-as-stuck,
   regression log, `bodyBlocksCell` volume checks (self + partner, radius-8
   partner scan), occupancy counts as cell strikes (campers displace).
7. **Anti-pin** (`actions.js`): per-cell strike memory (pruned to current
   mismatches; already-placed races excluded), 2 strikes → grounded vacate
   (walk to a searched standable spot out of the way, fly only if none) +
   retry same pass; reposition rounds don't count as stuck (cap 2/level).
8. **Telemetry** (`experiment_log.js`, warns): `runs.jsonl` events with
   `pos`/`side`/`helping`/`vacated`/`stall_relog`; `[bound]` + forensics
   console lines (target, distance, below, feet, effects, velocity,
   vehicle, gravity, on-ground).
9. **Run discipline**: fresh north site per run (all `coordinates[2]` −30 —
   restarts resume, so freshness is the only clean comparison); score with
   `tools/analyze_runs.py`, never by reading consoles raw; vivid records
   (full diff + command + coords + scorecard + mechanism).

## Dead ends — do not retry

Blocking commands (60× loop); history seeding (ignored twice); stripping
chat/prose (vetoed); any build slash-command (vetoed — normal players only);
occupancy-defer-without-stuck (98 passes, 3 placed, infinite retry);
support-gate wait + level split (one missing bot wedged everything);
`stop()` on hung trips (poisons the next nav); one-flight-per-level
(strands bots out of reach); eject-first movement (hover kills all foot
nav — walk first, eject as fallback, land after).

## Reproduction gates

- Andy pair (local micro): expect true 15/15 within ~2 runs at a fresh site.
- Muse pair (API): expect 15/15 in one 1000 s window on this scaffold
  (ran 9/15 on the run-22 tree; efficiency closed the gap, not more time).
- Gemma pair (local 12B): expect 15/15 (proven runs 34, 37; needs no tuning
  beyond temp-0/16k, predict uncapped).
- Health bars per run: single-digit `[bound]` lines, zero unreturned
  executions, zero regressions, litter ≤2 (respawn windows only),
  re-logs 0 (failsafe quiet unless wedged).

## New environment (reproduce from scratch)

Base: clean checkout at `25c5ba7`, then apply the frozen build on top. The
build is exactly these tracked changes plus one new file (nothing else):

- Modified (14): `.gitignore`, `profiles/andy1.json`,
  `profiles/andy2.json`, `profiles/defaults/_default.json`,
  `profiles/gemma1.json`, `profiles/gemma2.json`,
  `src/agent/commands/actions.js`, `src/agent/commands/index.js`,
  `src/agent/history.js`, `src/agent/library/skills.js`,
  `src/agent/tasks/construction_tasks.js`, `src/agent/tasks/tasks.js`,
  `src/models/prompter.js`,
  `tasks/construction_tasks/custom/church_two_agents.json`
- New (1): `src/agent/tasks/experiment_log.js` (the `runs.jsonl` harness)
- Do NOT carry: `bots/` (per-run logs), `node_modules/`, any
  `experiments/runs/*.console.log` (gitignored by design),
  `profiles/defaults/_default.json.bak` (local backup only)

Setup: Node v20 (`node --version` read 20.20.2 here), `npm install` from
`package.json`, a reachable Java 1.21.x server set in `settings.js`
(`host`/`port` — this repo points at `openmediavault:25565`, offline
auth), `keys.json` for API models only (muse pair via api.meta.ai —
Ollama pairs need no keys). Models: andy = Ollama
`Sweaterdog/Andy-4:micro-q8_0` + `embeddinggemma-2:270m-mxfp8-text`;
gemma = Ollama `gemma4:12b-mlx` (same embedder); muse per
`profiles/muse*.json`. Proven on a 16 GB Mac Mini.

First gate: fresh north site (shift every level's `coordinates[2]` −30
from whatever the file holds — site coords are per-run state, never
carried), then one andy-pair run:
`node main.js --profiles ./profiles/andy1.json ./profiles/andy2.json
--task_path tasks/construction_tasks/custom/church_two_agents.json
--task_id church_two_agent`
Expect true 15/15 within ~2 runs (score via
`experiments/tools/analyze_runs.py`). Then the muse gate (same command,
`muse1.json`/`muse2.json`) — expect 15/15 in one 1000 s window.

## Known limits (open, non-gating)

Sticky `Server refused` cells (L2 corner brick ×3 runs — body-volume
blocking + occupancy strikes target exactly this; untested against a live
pin since run 36 aborted on the hover wedge); `flyTo` hangs (server-path,
recurs — re-log now bounds the damage); model-stream and server-path
stalls (luck — bound and survive, never fixable in code); idle-camp
blocking on slow models (park-between-passes would erase it); re-log
failsafe never fired in prod (probed only — run 37 stayed healthy).
