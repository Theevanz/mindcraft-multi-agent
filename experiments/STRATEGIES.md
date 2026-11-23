# Strategy ledger (distilled from `findings.md`, 2026-11-20→21)

Notation: Cn = kept change, Rn = root cause. All detail lives in findings §4.
Baseline for the next session is clean HEAD (`25c5ba7`) — i.e. WITH the R1/R2
bugs still in. T0 is therefore a negative control, not a real attempt.

## Re-test (worked — queue order for the runs)

- **T0 — clean baseline, fresh north site.** Expect dirt houses (R1: goal never
  carried the blueprint; R2: `explain()` was content-free). Control only.
  Verdict (run 1, 2026-11-21): CONFIRMED — 0 verifier calls, 0 completions,
  1.27%. Site deviation: ran at z=29, north move unapproved. (First record
  misattributed pre-lab analyzer rows; corrected in the run file.)
- **T1 — goal plumbing + compact facts (C2, C3).** `getAgentGoal` returns
  blueprint + SOP-first; `explain()` = site line + `name: count` materials.
  Killed the "153x planks read as dimensions" misread (R2/R5).
  Verdict (run 2, 2026-11-21): WORKS — 0→26 verifier mentions, 1.27%→17.61%,
  0 completions (engine missing, as expected). Keep, move to T2.
- **T2 — the engine (C4/C7, C12, C18, C19, C20).** Reroute `!newAction` to the
  deterministic builder; hand-build (`dontCheat`, removals first, single door
  place); per-block isolation; stuck-skip (3 dead passes → next level);
  redirect escalation on 3rd dodge. **This is the 11-25 core that peaked at
  L8/L7 (~9/15, 60%) — the all-time best.**
  Verdict (run 3, 2026-11-21): WORKS, below peak — streak 3/15 (L0–L2),
  54.90%, 387 placed. Single L3 cell (15,-57,-30) failed 29x; needs T4
  movement. Excluded from my T2: fly/noDig (T4), parking (T6), regression
  + run_start (T5), C14, C17 (T3), C32/33 setup audit. Keep, move to T3.
- **T3 — attention guardrails (C15, C16, C17, C22, C23, C24).** No forced
  inter-bot chat (killed the 30-turn taiga loop + 80-plank giveaway); distractor
  commands redirect; blind-task integrity; static `$MEMORY` status line;
  temp-0/terse/16k profiles; 9 command docs.
  Verdict (run 4, 2026-11-21): WORKS — redirects 10, snapshots 47, no chat
  loops, score flat 54.6% vs 54.9%. Same L3 cell fails 40x at fresh site:
  pipeline is navigation-bound. Keep, move to T4.
- **T4 — movement honesty (C26, C28, C29, N3).** No autoDelete wipe (resumes);
  `noDigNavigate` (fail honestly instead of digging through the church);
  `flyNearIfNeeded` (chimney/fence reachable); `unstuck` off.
  Verdict (run 5, 2026-11-21): LIVE BUT WEDGE UNMOVED — self-tp/no-wipe
  verified, fly+noDig active, yet same L3 cell fails 151x (mineflayer throws;
  not reachability). Score flat 54.4%. Run-3 diagnosis was wrong. Keep, T5
  next (C13 is L3-relevant; C14 torch-litter question open).
- **T5 — diagnosis layer (N2, N4, C13, +pos logging).** Door-half discipline;
  `wall_torch` normalisation; regression log (clean-then-dirty names coords);
  `pos` on build events. No behavior change — makes stalls attributable.
  Verdict (run 6, 2026-11-21): BREAKTHROUGH — C13 unblocked L3, 99.11%,
  streak 12 (L0–L11 union), wedge 151x→13x, 6 regressions all on door
  column x=15. N2 was already live from T2. Keep, move to T6 (+C14).
- **T6 — anti-stall (my 11-21 fix, in backup patch).** Re-park on every wait
  inside footprint; `item_collecting` + `elbow_room` off; `park_failed` logged;
  occupied-only passes count as stuck (C34 reverted). Untested — first real
  experiment of the new session, then the 11-25 restore below.
  Verdict (run 7, 2026-11-21): SPLIT — andy2 healthy 11m (streak 10, fence
  frontier L10/11, 0 regressions, 98.81%); andy1 hung silently 4m in
  (unguarded goto, in-repo gap). C14 folded in: litter dozens→4 VERIFIED.
  Parking never fired live (probe TRUE). Probe OCC line conflicts with
  ledger (encodes banned C34) — ledger wins, not chased. T7 next.
- **T7 — 11-25 restore (my 11-21 change, in backup patch).** No level split,
  no support-gate wait, grind-and-skip. The other session's starting hypothesis.
  Verdict (run 8, 2026-11-21): LEDGER ALREADY LIVE (verified no-op) — the
  turn's real variable (gotoBounded 20s) REGRESSED the build (98.81%→82.20%,
  streak 10→5): stop() poisons follow-on nav. Reverted. Mode-offs found
  partially ineffective (12 torches despite setOn false).
  Run 9 (T7-tree retest): both bots hung mid-pass at 96.74% (4m) — hang
  class confirmed ×2 (3 in 2 runs). Lib trace: goto() hangs when a path
  exists-but-never-completes; stale stopPathing flag explains run-8
  poisoning; abandonment is lib-sanctioned (goal_updated supersedes).
  Run 10 = abandon-only timeout (30s, no stop).

Crash fixes to re-apply at their steps, not test separately: C9 (partial
results), C10 (quote sanitize), C11 (re-verify count), C21 (log builder
result), C30 occupancy-note wording, C32/C33 no-commands audit (constraint,
always on).

## Do NOT retry

- **Blocking `!newAction`** (C5): 60x `does not exist` statue loop. Redirect,
  never block — micro models loop on errors (R6).
- **History seeding** (C6): landed late, ignored twice. Micro models do not
  imitate history.
- **Stripping chat/prose:** vetoed by user. Chat/history/memory stay 100%
  verbatim — they are the observability.
- **Any build slash-command** (`/setblock`, `/fill`, `/give`, `/tp`, ...):
  user constraint, normal-player-not-admin. Only the 9-44 cheat run finished
  the church; it proves nothing about hand-building.
- **Occupancy-defer-without-stuck (C34 as written):** 01-19 run, 98 passes /
  3 placed / occupied=118, infinite retry. Reverted in T6.
- **Support-gate wait + level split as written (C27/N1):** 14:41 run proved it
  — one missing bot wedged the whole pipeline (120 waitings, 0 placements
  after L0). Only revisit if shared-lowest plateaus (low priority).

## Already written, in the backup patch

`experiments/baseline-backup/working-tree-2026-11-21.patch` contains T6+T7
plus the two north moves — re-apply per step with `git apply --include` or by
hand, don't rewrite from scratch. Untracked session files sit beside it
(`FINDINGS.md`, `experiment_log.js`, `_default.json.bak`).

## User direction (2026-11-21, user's own words filed verbatim in spirit)

1. **Lean context is good.** User endorses keeping context clean and
   hallucination-free. Accurate attribution: we never delete chat/history/logs
   (user's veto stands — nothing is ever stripped). Leanness comes from
   *not generating* noise: no forced bot-to-bot chat (C16), 9 command docs
   (C24), static `$MEMORY` status instead of fantasy summaries (C22).
   Keep this line: starve noise at the source, never delete evidence.
2. **No hypertuning to the church.** Improvements must transfer to other
   blueprints. Rules: dimensions derived from blueprint data, never hardcoded
   church constants; prefer generic mechanisms. Regression gate: the muse
   pair built the church on baseline (§2) and must still build it on the
   final scaffold — ship criteria = andy pair 15/15 AND muse pair 15/15.
3. **Vivid logs + vivid findings.** Every run record must let the user
   evaluate and recreate the run in a fresh session: full strategy diff
   attached, exact run command, site coords, scorecard, mechanism-level
   observation. Findings stay narrative like findings.md, not just numbers.
4. **Babble-while-building is fine.** User cites the run where the bots
   spammed "build a 3x3 dirt hut" while actively building the church (11-25
   histories: dirt-house prompts alongside L1–L8 completions) as impressive,
   not broken. Judge runs by placements/levels only. Never spend a run
   chasing coherent chat, and never "fix" divergence by constraining what
   the model may say — that trades the engine for cosmetics. (Findings P3.)

## Post-queue runs (T0–T7 exhausted at run 8)

- **Run 9 (T7-tree retest):** both bots hung mid-pass at 96.74% (4m) —
  hang class confirmed ×2. Lib trace done (see `runs/9.md`).
- **Run 10 (abandon-only nav timeout, 30s, no stop):** SUCCESS — full
  windows, timeouts fire + recover, zero poisoning, 99.11%, truth 14/15
  (only L3 missing). Wedge mechanism identified: bottom-face-only
  placement vs the door below; places only when door absent.
- **Run 11 (face-fallback placement):** SUCCESS — wedge ZERO mentions,
  validator-success in 4m, one L11 fence short ("No path to the goal").
- **Run 12 (planned):** vertical-gap fly (fly when target >4 above).
- **Run 12 (vertical-gap fly):** MIXED-POSITIVE — andy1 did L11 (fence
  placed), 98.82%, pin moved to L12–14 = EMPTY levels dirtied ONLY by
  torch litter. Mode-offs root-caused: 15s all-on window per (re)spawn
  before initBotTask's end-block runs (not resets, not !setMode).
- **Run 13 (planned):** reliable mode suppression (top-of-init + per-pass).
- **Run 13 (mode suppression):** VARIABLE VERIFIED (litter 12→0) but run
  collapsed (67.06%) via andy1 model-wander + andy2 hang — no mechanism
  links either to the change. AMBIGUOUS → run 14 same-coords re-run.
- **Run 14 (planned):** run-13 code, SAME coords (disambiguator).
- **Run 14 (same-coords):** RUN ISSUE (different signature) — resumed-site
  hard-cell grind, 67.06%→71.22%, 6 slow passes. Exonerates run-13 code
  (suppression holds, no wedge/fence/hang fails). "Path was stopped"
  provenance: interruptions suffice (no stop in tree). 8.md corrected.
- **Run 15 (planned):** run-13 code, FRESH coords (recovery confirmation).
- **Run 15 (fresh retest):** RUN ISSUE — synchronized 746s event desert in
  both processes at L5 (server-path stall, then recovery). Pre-stall pace
  healthy (30s/pass). v2 timeouts uninvolved (3 total) → stall sits in a
  non-goto await (dig/place/lookAt/equip unbounded — noted, not chased).
- **Run 16 (planned):** same code, FRESH coords (ship attempt).
- **Run 16 (fresh ship attempt):** STRATEGY hang, 5th+6th instances — both
  bots silent mid-pass (L6 round) to timeout, 85.16%. goto/fly/park all
  bounded → hang is in dig/place/equip/lookAt.
- **Run 17 (planned):** bound remaining awaits (dig+stopDigging, rest abandon).
- **Run 17 (await bounding):** RUN ISSUE — model-backend stall (responses
  stop, no errors), 50.74%, both bots idle ~last 8m. Bounding verified
  (timeouts fire, no hangs). Record first drafted with run-15 numbers by
  mistake; corrected from disk. Stall taxonomy complete: nav (fixed),
  server (luck), model-stream (luck).
- **Run 18 (planned):** same code, FRESH coords (ship attempt).
- **Run 18 (fresh ship attempt):** RUN ISSUE — andy2 model-stream stall
  at 2m; andy1 soloed to L6/86.65%. Model stalls now modal (4 of last 6
  runs). 2 runs of budget left.
- **Run 19 (planned):** same code, FRESH coords (andy ship attempt).
- **Run 19 (fresh ship attempt):** HEALTHY but SLOW — both full windows,
  L0–L6, 83.38% timeout. ~100s/pass (run 11: ~8s). Per-cell overhead
  stacked (fly-per-cell + multi-face + timeout tail). No structural
  fails. Ship unreachable in budget (needs 2 perfect runs, has 1).
- **Run 20 (planned):** muse pair gate on final scaffold.
- **Run 20 (muse gate):** NOT PASSED on the letter (9/15, L0–L5) — cadence,
  not scaffold: 2m/API-turn → 15 passes in 30 bot-min. Zero structural
  fails, textbook verify behavior, no hangs. No scaffold regression.
- **PROGRAM END (20/20 spent):** ship UNMET. Andy best: validator-100%
  (run 11), truth 14/15 (run 10). Muse: 9/15 (cadence). Next: longer
  windows, pace diet, endgame push (see runs/20.md).
- **Run 21 (planned):** fly batching (fly-once-per-pass), budget extended to 22.
- **Run 21 (fly batching):** STRATEGY REGRESSION — L0–L3 in ~2 min (batching
  works where foot-reachable), then L4 wall: batched flight strands the bot
  >4.5 from most cells and the walk fallback can't close it (hover can't
  walk, 3-up unclimbable under noDig) → every L4 cell burns 30s nav timeout,
  8–9 min passes, score frozen 60.24%. Per-cell fly was a proximity
  guarantee, not just positioning. Proposed: revert to run-20 tree for run 22.
- **Run 22 (planned):** muse pair gate on reverted (run-20) scaffold, fresh
  z=-571 — pending user approval of the revert.
- **Run 22 (muse gate, reverted tree):** NOT PASSED on the letter (9/15,
  L0–L5 + L6 partial, 89.02%) — cadence, not scaffold (run-20 repeat,
  slightly deeper). 18 passes / 26 bot-min ≈ 1.4m/turn; zero structural
  fails, zero hangs, zero litter. Clean L4 confirms run-21 wall was the
  batching variable. No scaffold regression.
- **Run 23 (planned):** soft in-level spatial bias (order low-X/high-X first by count_id, same pass, no ownership) — teamwork approximation, budget extended to 23.
- **Run 23 (spatial bias):** STRATEGY SUCCESS (variable) + new hang finding — L0–L5 in ~2 min (best pace since run 11), side live all 21 passes, occ=0 across 12 combined L2–L5 passes, failsafe intact (L0 stuck-skip), zero wedge/litter/regressions. Terminated by in-pass freeze (7th/8th hangs): two !newAction never returned, loops frozen, score crept 80.4→84.6 via console-invisible placements then flat; user-stopped at 84.57%. Prime suspect: unraced startFlying (only unraced await left; action timeout disabled). Proposed: race startFlying for run 24.
- **Run 24 (planned):** conditional-help partition (own half only, help iff own clean) + raced startFlying — strapped pair, budget extended to 24.
- **Run 24 (partition):** STRATEGY SUCCESS — 97.92%, deepest andy run since run 11 (L0–L7 union). occ 0+1/50 passes, races 27→14 (residual = scan-to-act overlap), help pattern textbook, no freeze recurrence. User observations adjudicated: andy2-idle CORRECTED (27 passes, low-yield — beaten to completions), stood-on loop CONFIRMED (pos == failing cell ×6 passes, 19/19 redirects = swallowed !moveAway, back-off fails). Per-cell counting hypothesis REJECTED (per-level skip flowed). Pin: 7 unplaceable cells (stood-on reachability + cascade, all-faces-throw L2). Proposed: stand-off ejection + error surfacing for run 25.
- **Run 25 (planned):** stand-off ejection + last-face-error surfacing (skills.js strapped pair) — budget extended to 25.
- **Run 25 (ejection):** ABORTED at 30.56% (user-ended, motionless bots) — in-pass freeze recurred (execution 3241 never returned, all model calls answered, no errors). Ejection/surfacing UNTESTED (never reached). Suspect revision: unraced startFlying (raced since run 24) demoted; all race catches are silent, so firings are unfalsifiable — telemetry needed before next attribution. Re-run same code at fresh site.
- **Run 26 (planned):** run-25 code, FRESH z=-691 (recurrence test).
- **Run 26 (recurrence test):** STRATEGY REGRESSION — 29.38%, zero levels done. My ejection backfires: unconditional walk back-off after a successful eject burns a guaranteed 30 s hover-timeout per ground cell (timeouts 15 at y=-60 + 4 at y=-59 + 0 above; 9 combined on 12,-60,-682). Freeze recurred (10th, execution 4836 unreturned). Console overwrote run 25's log (renamed after the fact). Proposed: guard the back-off with `if (!ejected)` for run 27.
- **Run 27 (planned):** ejection guard (`if (!ejected)` skip walk back-off) — budget extended to 27.
- **Run 27 (guard):** STRATEGY REGRESSION — 25.52%, user-ended (bots idle-staring). Guard fixed the double penalty but hover PERSISTS: andy1 ejected once, hovered at y=-58 all run, 1 pass (41 fails) then a goTo-timeout loop with a healthy model loop. andy2 froze (11th instance, execution 2701 unreturned). Differential verdict: run 24's rare hover flew; eject-first constant hover storms. Guessing ends here — next is hover discipline + firing telemetry (proposed).
- **Run 28 (planned):** hover discipline (walk-first, eject fallback, land after eject) + `[bound]` telemetry — budget extended to 28.
- **Run 28 (discipline):** STRATEGY SUCCESS — 94.36%, full windows, L0–L5 by 13:28, L6 grinding to rem=12. No stranding, no timeout storm (47 timeouts diffuse). Telemetry exonerated apparent freeze #12 (11 alternating warns after line 6600 = alive mega-grind, user ended mid-pass). Named: `Server refused to place` (packets unapplied, L6 repeats) + `eject timeout` = flyTo hanging (open Q3 recurs). Remaining tax: fly-hover never lands (landing covered eject-gated cells only). Give-up chat was label-only babble (P3). Proposed: land-after-every-cell for run 29.
- **Run 29 (planned):** land-on-walk-demand (`landIfFlying` at `gotoBounded` top) — budget extended to 29.
- **Run 29 (landing):** TRUE andy-15/15, FIRST EVER — validator 100% + `Task successful` + independent all-15 scan + L0–L11 lines, in ~4 min. Timeouts 47→6, no stranding, no freeze. Caveats: effectively 1.5 bots (andy1 model-stalled at 13:51, andy2 soloed via help-fallback); clean-window luck unruled-out. Ship half-met. Next: replicate (run 30), then muse gate (run 31).
- **Run 30 (planned):** same-code replication at z=-811 — budget extended to 30.
- **Run 30 (replication):** PASS with caveat — 99.70%, truth 14/15 (only L2: cell 18,-58,-800 Server-refused ×6, both bots). Roles swapped (andy1 259/7 carried; andy2 37/97). Solo-carry pattern explained: failsafe masking — every single-bot failure renders as solo carry. The two deaths DIFFER: run-29 andy1 = model-loop silence; run-30 andy2 = camped wedge, healthy loop (camp [18,-60,-800] 5 min). Server-refused has transient + sticky modes. Ship still half-met. Next: muse gate OR wedge chase (proposed).
- **Run 31 (planned):** muse gate on final scaffold (ship second half).
- **Run 31 (muse gate):** PASSED — TRUE muse-15/15 (validator 100% zero-tolerance + in-flight confirmation: direct !buildBlueprintLevel(6) after a 3+skip verdict, validator fired mid-pass). 9/15 → 15/15 on the same window (scaffold efficiency, not more time). 7 warns, 0 hangs, occ=25 (idle-camp blocking — polish). Run 11's "one short" now SUSPECT (same logging race shape). SHIP MET.
- **Run 32 (planned):** gemma pair gate on final scaffold (closes open Q4) — budget extended to 32.
- **Run 32 (gemma):** 14/15 (L6 rem=1) — scaffold transfers ×3 (zero new failure classes), pinned on the SAME L6 west-strip plank (13,-54,-867, refused ×8; runs 28/31 same column). Data legal (side neighbors solid) → engine-side: body-in-cell (camper photographed). Missing mechanism: per-cell memory must drive MOVEMENT. Next: vacate-then-retry (run 33, approved).
- **Run 33 (planned):** per-cell 2-strike memory → vacate (fly ~4 out) + defer + reset — budget extended to 33.
- **Run 33 (vacate):** 14/15, same pin 4th run (L6 bx=1 bz=5, refused) — vacate fired ONCE all run (design flaw: level-skip wedges after one vacate, never iterates). Fix approved: grounded feet-first vacate + retry-same-pass + no-lockout (cap 2).
- **Run 34 (planned):** grounded vacate (walk-to-spot, fly fallback) + retry + no-lockout cap 2 — budget extended to 34.
- **Run 34 (grounded vacate):** GEMMA TRUE 15/15 (validator 100% + successful; L11 print lost to validator race) — 3/3 families green. L6 pin absent (positional luck; vacate untested-again, fired once on L2). gemma2 stranded outside on a perch 4+ min: no-fly-no-walk gap (2–3 above within 10: no flight, unclimbable) + vacate blind to x1-shotgun fails. Proposed: fly-threshold gap≥2 + telemetry upgrade (run 35).
- **Run 35 (planned):** fly-threshold gap≥2 + telemetry upgrade — budget extended to 35.
- **Run 35 (gap fix):** 14/15 (L2-corner brick refused-from-everywhere ×15, 3rd occurrence — mechanism OPEN). Gap fix HOLDS (no dead-zone strands). gemma2 marooned south-outside (all 12 labeled timeouts; ground=false + terrain below — liquid vs hover UNSETTLED, feet-block missing). gemma1 solo-swept (300/10). Proposed: re-entry failsafe + refusal forensics + warn labels (run 36).
- **Run 36 (planned):** re-entry failsafe + refusal forensics — build STARTED then REVERTED for distillation; LATER SUPERSEDED by body-aware blockage (L2 diagnosis) before launch — budget extended to 36.
- **Run 36 (blockage):** ABORTED at 72.7% (user SIGINT) — gemma2 static-hover 8+ min, all movement dead, landIfFlying no-ops (gravity reads nonzero while airborne). Triaged: half-dead connection vs effect suspension vs embed (blueprint webs eliminated). L2 pin unreached (gemma1 swept it). Proposed: stuck-state dump + re-log failsafe (run 37).
- **Run 37 (planned):** stuck-state telemetry + re-log failsafe — budget extended to 37.
- **Run 37 (re-log):** GEMMA TRUE 15/15 AGAIN (validator 100% + successful; L11 print lost to race) — 4th true completion (29, 31, 34, 37). L6-west refused ×7 then landed (transient). Zero re-logs (correctly silent), 11 diffuse warns, no new failure classes. FREEZE recommended.
- **PROGRAM END (37/37 spent + spec):** SHIP MET ×3 families, repeated (gemma ×2).
  Final scaffold = run-37 tree. Next: refresh `STRATEGY.md` (runs 36–37 delta), then stop. Spec: `STRATEGY.md` (stale on runs 36+ — needs a refresh pass if the program continues).

## Open questions for the runs to settle

1. What wiped 6/15→~0 between 00:47–01:08 with zero logged removals?
2. Why did andy2 die <1 min into the 14:41 run (no history, 14 waitings)?
3. Why did 120 parks never move andy1 on 14:41 (silent `flyTo`/walk fail)?
4. ~~gemma1/2 profiles fixed but never run — the loop should try them once.~~ DONE (run 32: gemma debut, 14/15, transfers clean).
