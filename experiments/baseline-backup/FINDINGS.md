# Blueprint Build Investigation — Findings

Session: 2026-11-20 → 2026-11-21. Task: make small local models
(Andy-4 micro, Gemma 12B, no thinking) build the 15-level
`church_two_agent` construction blueprint together on a 16 GB M6 Mac Mini.
Reference success: `muse-spark-1.3-contributor` built the same church
twice. User constraints discovered along the way: strictly no in-game
build commands (`/setblock` etc — build by hand), keep thinking off
(tok/s), never strip chat or logs (they are the observability).

## 1. Model lineup

- `profiles/andy1.json`, `profiles/andy2.json`: ollama
  `Sweaterdog/Andy-4:micro-q8_0`, was `num_ctx 32768`, now
  `num_ctx 16384, temperature 0, num_predict 120`.
- `profiles/gemma1.json`, `profiles/gemma2.json`: ollama
  `gemma4:12b-mlx`, `think: false` (thinking too slow on the Mini),
  now plus `num_ctx 16384, temperature 0, num_predict 120`.
- `profiles/muse1.json`, `profiles/muse2.json`: `muse-spark-1.3-contributor`
  via `https://api.meta.ai/v1` (OpenAI-compatible). The capable reference.
- Embeddings: andy/gemma use ollama `embeddinggemma-2:270m-mxfp8-text`;
  muse uses `openai`. This drives `Examples.getRelevant` (`num_examples=2`)
  and `SkillLibrary.getRelevantSkillDocs` (`relevant_docs_count=5`).
- Pre-existing local mods (present before this session, kept):
  `profiles/defaults/_default.json` conversation examples swapped to
  blueprint-workflow examples; `church_two_agents.json` coords moved.

## 2. Run timeline (all times +08)

- 11-19: baseline. Muse pair builds church at X12 together.
  Andy/Gemma build dirt houses, ignore the blueprint.
- 11-20 20:46 (`11-20-2026_8-46-16PM/56PM.json`): andy1/andy2,
  self-prompt `Make a structure with the blueprint below` with NO
  blueprint content attached. Both do
  `!newAction("Build a simple dirt house...")`. Never call a blueprint
  command.
- 11-20 19:55–20:10 (`muse1/2 7-55/7-56PM.json`): muse pair succeeds at
  X12. First moves are `!getBlueprint`, then `!getBlueprintLevel(0..10)`,
  `!checkBlueprint`, then `!newAction` with embedded placement arrays,
  `/fill` shortcuts, per-level verify. The proof the instructions suffice
  for a capable model.
- 11-20 21:27–21:30: andy pair with blueprint goal text. andy2 reads
  `153x oak_planks` as dimensions, generates a 153x113 place loop,
  `Code execution refused stop after 10 seconds. Killing process.`,
  then a `!placeHere` wander loop. andy1: `!stats → !nearbyBlocks →
  !newAction(3x3 cube)`; codegen fails 5/5.
- 11-20 21:35 (`9-35-34/39PM.json`, 136/73 turns): SOP-first goal era +
  `!newAction` blocked. andy1: ~60x `!newAction` → `Command !newAction
  does not exist` (statue). andy2: `!newAction`/`!moveAway(100)` alternation
  to (273,-60,-141) (runner). Each called `!checkBlueprintLevel(0)` exactly
  once (bare, no prose — actually the seeded history turn) and ignored it.
- 11-20 21:44 (`9-44-23/27PM.json`): `!newAction` rerouted to deterministic
  `/setblock` builder. CHURCH COMPLETES at X42. Ugly parts: ~30-turn
  bot-to-bot chat loop ("chilling in the taiga"), andy2 gives Theevanz 80
  planks, `!placeHere("spruce_stairs")` pollution oscillates level 0
  (`Placed 1, 1 still need fixes`).
- 11-20 22:05: stillborn run. `memory.json` = 1 turn, no self-prompt.
  Cause: my SOP contained `!newAction("...")` double quotes inside the
  `!goal("...")` wrapper; `parseCommandMessage` split it into 2+ args and
  rejected it. Self-prompting never started. Fixed (single quotes +
  sanitize + warn in `setAgentGoal`).
- 11-20 22:34 (`10-34-49/47PM.json`, 515/509 turns, X72, hand-build era):
  levels 0–2 built by hand. andy1: 251 `!newAction`, 242 ending
  `Level 3: could not place anything, 1 still need fixes`. andy2: 131
  `!newAction`, 115 `!moveAway` (redirect-text loop), 3x `PathStopped`
  whole-level aborts.
- 11-20 23:25 (`11-25-43/41PM.json`): first run with per-block isolation +
  stuck-skip + escalating redirects (X102). NOT examined in detail.
- 11-20 23:49–00:03 (X132, all fixes, stopped by user as "spiralling"):
  `runs.jsonl` scorecard: andy1 18 passes / 62 placed / 25 failed /
  2 levels; andy2 15 / 132 / 35 / 2. Truth line: `4/15 levels complete.
  Working on level 1`. Both bots loop `L1 placed=1 rem=0` — a single
  level-1 block is placed, verifies clean, then vanishes before the next
  pass. Top failure strings are generic (`Failed to place ...`,
  `already at` races). Model memory vs truth (andy1): survival fantasy
  (`20+ sticks, 15 crafting_table, iron armor goal, smelting`) vs
  `4/15 complete, working on level 1`. andy2's memory improved (echoes
  the static status line).
- 11-21 00:20 (3 min, Z-1 site): FIRST split run. andy2 (odd levels):
  18 passes, 0 placed, 348 failed — every L1 block `nothing to place on`
  because L0 did not exist yet. Support-order deadlock from the split
  itself; user stopped it. andy1: 77 placed, 1 level.
- 11-21 00:25 (5–6 min): reached 9/15, then stuck. Regressions: L0 lost 5
  floor planks in a row, plus L2/L4 damage — pathfinder digging through
  the fresh build en route. Upper chimney/fence unplaceable (no support
  below + unreachable on foot). andy1's chat starts using the canonical
  `Build the next blueprint level` prompt (temp-0/static-memory working).
- 11-21 00:34: restart to continue 9/15 instantly wiped the site via
  `teleportBots → autoDelete` mass `/setblock air`. 0-minute run.
- 11-21 01:08 (3 min, Z-1 site): resumed at 3/15 — the 6/15 from 00:47 was
  gone with no logged remover (no run between 00:47 and 01:06 touched
  blocks; cause unknown — external wipe or server rollback?). andy1
  rebuilt L0 (72 placed, occupied=14); andy2 waited (168 events). Then
  deadlock: andy2 had parked ON L0, andy1's last cells skipped as
  occupied, skips fed the stuck counter, L0 abandoned, andy2 gated on L0
  forever. Both parked, nothing moving.
- 11-21 00:43 (4 min, Z-1 site, resumed): 6/15 then both bots parked in
  `waiting` (152/180 events). andy2 ground 5x on L3 stone at (135,-57,0)
  with generic `Failed to place`: prime suspect is the other bot's body
  standing in the target cell (`bot.placeBlock` throws on entities in the
  way) — a mutual standoff, both waiting, neither moving. andy1's memory
  still dirt-shack fantasy; static `$MEMORY` holds the prompt on truth.

## 3. Root causes found (numbered)

R1. **Blueprint never reached the goal.** `Task` constructor built
    `this.goal = data.goal + blueprint.explain()`, but `getAgentGoal()`
    returned raw `this.data.goal`. `setAgentGoal → !goal → self_prompter`
    therefore carried only `Make a structure with the blueprint below`.
    Same for conversation (`initBotTask` used `this.data.conversation`).
    File: `src/agent/tasks/tasks.js`.
R2. **`explain()` was content-free.** It listed only per-level start
    coordinates (placement dump commented out). Block detail lived only
    behind `!getBlueprintLevel` / `!checkBlueprintLevel`, which small
    models never call unprompted. File:
    `src/agent/tasks/construction_tasks.js`, `Blueprint.explain`.
R3. **Capability gap, not instruction gap.** Same prompt: muse fetches 11
    levels then writes array-embedded code; micro models emit one
    `!newAction("dirt house")`. 15 levels x ~120 cells + long-horizon
    tool use exceeds what `Andy-4:micro-q8_0` / `gemma4:12b` (no think)
    can plan. Evidence: histories above.
R4. **Profile bugs.** `gemma1.json`/`gemma2.json` had `"name": "andy1"` /
    `"andy2"`, colliding with the andy bots' folders and memory. Fixed.
R5. **Example/doc retrieval bias.** `num_examples=2` + tiny embedding
    retrieves the `brug: build a dirt house` coding example for
    dirt-biased queries; `Materials: 153x ...` was misread as dimensions.
R6. **Blocking commands backfires on micro models.** Removing `!newAction`
    produced a 60x `does not exist` loop, not a pivot. Redirects that only
    return text loop the same way (115x `!moveAway`). Lesson: never answer
    a small model with an error — do something useful instead.
R7. **`checkLevel` returned `false` on block errors**, crashing every
    caller (`result.mismatches` of `false`). Now returns partial results.
R8. **Per-block throws aborted whole levels.** One `PathStopped` in 76
    placements killed the pass. Now isolated per block with reasons.
R9. **Stale error text hid the goal bug.** `setAgentGoal` ignored
    `executeCommand` results, so the 22:05 quote-parse failure was silent.
    Now sanitizes quotes and warns.
R10. **Two-bot races.** Both bots built the same level concurrently:
    `already at` waste plus suspected door-half wars (§5).
R11. **Model-written memory is fiction. [see §4 C22]** Taiga/sticks/iron-armor summaries
    of church turns; then fed back as `$MEMORY` facts. Prompt now uses
    computed status on blueprint tasks; model summaries still recorded.
R12. **`unstuck` mode sabotages slow builds.** `modes.js` `unstuck`
    (`interrupts: ['all']`) fires when the bot moves <2 blocks in 20 s:
    kills the in-flight pathfinder goto (the `PathStopped` aborts) and
    wanders 5 blocks mid-level. Breaks nothing itself, but perturbs every
    long pass. Queued for disable on blueprint tasks.
R13. **Two-bot races (detail).** Beyond `already at` waste: suspected
    door-half war L1/L2/L3 — L2 places `oak_door` at the upper cell
    (stray half in L3), L3's expected-air removal breaks the stray and
    cascades through the whole door. Mechanically verified in code, never
    fully proven from logs (placements succeed, then revert silently
    between passes). See P1.
R14. **Every restart wiped the site.** `teleportBots` (`tasks.js`) ran
    `blueprint.autoDelete()` — mass `/setblock air` over all 15 levels —
    on every construction start, plus `/tp @a` (teleporting the human
    too). The 00:34 "continue" run vaporized 9/15 levels in seconds.
R15. **Level split broke support order.** Odd levels physically need the
    even level below for the first block's adjacent face. Both bots
    starting together meant the odd bot failed 100% (348 fails, 0 placed)
    until the even bot finished below.
R16. **Pathfinder demolishes the build.** `goToGoal` falls back to
    DESTRUCTIVE movements (dig through anything) when the 1 s
    non-destructive plan fails — and even the "non-destructive" set only
    spares glass. Evidence: 5 L0 floor planks in a row broken along a
    travel path, plus L2/L4 regressions. Upper chimney/fence are also
    unreachable on foot (7–14 blocks up, nothing to climb).
R17. **Mutual body-blocking standoff.** `bot.placeBlock` throws when any
    entity occupies the target cell. Two waiting bots park on the site;
    one stands on the other's last block; placement fails forever while
    both report `waiting`. Evidence: L3 (135,-57,0) failing 5x with the
    generic throw message while both bots idle.
R18. **Full slash-command audit (user: strictly no commands of any
    sort).** Found: `tasks.js` `/clear` (init + on-success), `/give`
    (setup), `/tp` (grouping, site, human); `skills.js` `/setblock`
    (cheat-gated place/break) + `/tp @s` (cheat-gated travel);
    `agent.js` `/skin` on login; `cooking_tasks.js` heavy `/fill`,
    `/setblock`, `/summon`, `/kill`, `/data` (other task family —
    untouched). Cheat mode defaults off (`_default.json`), armable only
    via `god_mode` base or `!setMode`. `resetConstructionWorld`,
    `autoDelete`, `autoBuild` now have zero live callers.
R19. **Parking-on-build + stuck-counter deadlock.** `parkAwayFromSite`
    moved 6 blocks random-direction, landing inside the 12x10 footprint;
    the other bot's cells then skipped as occupied; occupied skips fed
    `blueprint_stuck`, abandoning the level; the parked bot gated on that
    level forever. Evidence: occupied=14, then `failed 3+ times` on L0
    with 168/152 waiting events and zero motion.

## 4. Every change made, with verdict

- C1 KEEP gemma profile names `andy1/2` → `gemma1/2`
  (`profiles/gemma*.json`). Was corrupting bot folders.
- C2 KEEP `getAgentGoal` returns blueprint + SOP-first; `initBotTask`
  sends `this.conversation` (`src/agent/tasks/tasks.js`). Goal ~580 chars.
- C3 KEEP compact `Blueprint.explain`: site line + `name: count`
  materials (`construction_tasks.js`). Killed the dimensions misread.
- C4 KEEP `!buildBlueprintLevel(n)` deterministic builder (`actions.js`).
- C5 REVERTED blocking `!newAction`: 60x `does not exist` statue loop.
- C6 REVERTED history seeding with `!checkBlueprintLevel(0)`: landed late,
  ignored twice. Micro models do not imitate history.
- C7 KEEP rerouting `!newAction` → build next incomplete level. The engine.
- C8 KEEP `!moveAway` redirect, upgraded by C20 (bare text looped 115x).
- C9 KEEP `checkLevel` partial results instead of `false` (real crash fix).
- C10 KEEP `setAgentGoal` quote sanitize + warn + null guard (22:05
  silent goal death).
- C11 KEEP builder re-verify reporting remaining count.
- C12 KEEP hand-build rewrite (`dontCheat=true`, removals first, single
  door place). User constraint: strictly no build commands.
- C13 KEEP `wall_torch` validates as `torch` (L3 torches can only
  wall-mount; without this L3 never completes).
- C14 KEEP `torch_placing` off for blueprint tasks (site litter).
- C15 KEEP `!buildBlueprintLevel` blocked when blueprint queries blocked
  (blind-task integrity).
- C16 KEEP skipping auto `!startConversation` for blueprint tasks (killed
  the 30-turn taiga chat loop + 80-plank giveaway).
- C17 KEEP redirecting `!placeHere !givePlayer !followPlayer
  !searchForBlock !collectBlocks` (pollution/drain/drag closed).
- C18 KEEP per-block try/catch + failure reasons in message.
- C19 KEEP stuck-skip (3 dead passes → next level).
- C20 KEEP redirect escalation (3rd consecutive dodge builds).
- C21 KEEP logging `!buildBlueprintLevel` result to `bot.output`
  (`runAsAction` discards inner returns).
- C22 KEEP static `$MEMORY` status on blueprint tasks; model summaries
  still recorded + snapshotted vs truth (`prompter.js`, `history.js`,
  `tasks/experiment_log.js` new). Evidence: model says iron-armor
  fantasy while truth says `4/15 complete`.
- C23 KEEP PENDING DATA profiles `temperature 0, num_predict 120,
  num_ctx 16384` (all four local). 16k not 8k: 76-line check outputs
  could overflow 8k.
- C24 KEEP PENDING DATA command docs narrowed to 9 on blueprint tasks
  (`commands/index.js`); all remain callable.
- C25 KEEP experiment harness `bots/<name>/runs/runs.jsonl`
  (`run_start, build_pass, redirect, escalation, memory_snapshot`) +
  `/tmp/analyze_runs.py` scorecard. Produced every number in §2.

Dropped before shipping: strip pre-command prose (user veto — chat is
the observability; nothing is ever removed from logs).

Round 2 (post 00:34 wipe):
- C26 KEEP removed the `autoDelete` wipe; `teleportBots` teleports only
  self to the site. Restarts resume; also removes cheat commands from
  startup (human no longer yanked by `/tp @a`).
- C27 KEEP support gate in `buildNextBlueprintLevel`: level n waits for
  n-1 (logged as `waiting` events). Deadlock-free: lowest incomplete
  level is always buildable by its owner. Single-scan restructure.
- C28 KEEP `bot.noDigNavigate` during build passes: `goToGoal` uses
  `canDig=false, canPlaceOn=false` movements with no destructive
  fallback; placeBlock backup move likewise. Unreachable targets now
  fail honestly instead of digging through the church.
- C29 KEEP `flyNearIfNeeded` (creative only): flies within reach when a
  target is >10 blocks away, so the chimney/fence up high are buildable
  by hand. Falls back to walking on any error or in survival.

Round 3 (post 00:43 standoff):
- C30 KEEP occupancy skip in `buildLevelFixes`: cells containing another
  player are deferred with `(N skipped: <name> in the way)` + `occupied`
  in `build_pass` log events (analyzer shows totals).
- C31 KEEP `parkAwayFromSite`: waiting bots step 6 blocks off once (flag
  resets on next placement) so idle bodies can't hold cells hostage.

Round 4 (no-commands audit):
- C32 KEEP blueprint path uses zero in-game commands: setup `/clear` +
  `/give` skipped in creative (menu stocks itself), site reached by
  physical `travelToSite` (fly creative / walk survival), completion
  `/clear` skipped, login `/skin` skipped. Verified by mock probe:
  full `initBotTask` + travel emits zero `/` chats. Survival mode keeps
  legacy setup (hand-gathering 300+ blocks is out of scope).
- C33 KEEP `!setMode` redirected on blueprint tasks, closing the only
  model-reachable cheat switch (`god_mode` base would still arm cheats
  — operator's choice, flagged).

Round 5 (post 01:08 deadlock):
- C34 KEEP occupied skips no longer feed `blueprint_stuck` (someone
  standing in the way is transient, not failure).
- C35 KEEP parking flies/walks to a fixed spot outside the footprint
  (`minX-4`) instead of random 6-block drift.

## 5. Open problems

- P1. The L1 single-block oscillator (23:49 run). `L1 placed=1 rem=0`
  ~15x per bot: placed, verifies clean, vanishes before the next pass.
  Prime suspects: (a) two-bot door-half war (R13); (b) `unstuck`
  interrupting at the wrong instant (explains aborts, not removal).
  Current forensics cannot name it: successes leave no failure line.
  Queued: regression logging (clean-then-dirty level logs exact coords),
  bot level-split, door-half discipline (§8).
- P2. Failure strings are generic. Mineflayer swallows the real error;
  `Failed to place X at (...)` dominates. Mitigated by volume + the
  regression log; deeper tracing would need mineflayer patching.
- P3. Chat/action divergence by design. Model says dirt-house/nether
  babble; system builds church levels. Cosmetic; memory spiral contained
  by C22. True coherence needs a stronger model (Mini can't serve one).
- P4. Speed. Hand-build + micro inference ≈ 2–4 levels per 15 min for the
  pair. A full church is roughly an hour. Acceptable per user so far.
- P5. ESM import cycle `actions.js → conversation.js → commands/index.js →
  actions.js` (pre-existing). Safe only when `index.js` evaluates first,
  which holds in production (`agent.js` imports it first) — but probes
  and any new entry point must import `index.js` before `actions.js` or
  hit `actionsList` TDZ. Do not add heavier imports to `actions.js`.

## 6. Current architecture (how the scaffold works now)

1. `Task` (`tasks.js`) loads blueprint; goal = SOP-first + compact facts;
   `!newAction` on blueprint tasks reroutes in `actions.js` to
   `buildNextBlueprintLevel` (lowest incomplete level, hand-built via
   `skills.placeBlock`/`breakBlockAt` with `dontCheat=true`).
2. Guardrails: `!moveAway !placeHere !givePlayer !followPlayer
   !searchForBlock !collectBlocks` redirect to `!newAction`; the 3rd
   consecutive dodge builds anyway (`blueprintRedirect` counter).
   `torch_placing` off; no forced inter-bot conversation.
3. Verification after every pass; per-block isolation; stuck-skip;
   `wall_torch` normalization; `checkLevel` partial results.
4. Prompt aids: static `$MEMORY` status line, 9-command docs, terse
   deterministic profiles. Chat/history/memory files 100% verbatim.
5. Evidence: `bots/<name>/histories/*.json` (full turns),
   `bots/<name>/runs/runs.jsonl` (scored events),
   `/tmp/analyze_runs.py` (scorecard), `/tmp/blueprint_probe.mjs`
   (regression probes).

## 7. Experiment protocol

- Run: `node main.js --profiles ./profiles/andy1.json ./profiles/andy2.json
  --task_path tasks/construction_tasks/custom/church_two_agents.json
  --task_id church_two_agent`. Stop old run first (name collision).
- Fresh site per run: shift `coordinates[0]` (east) or `[2]` (north=-Z)
  by 30 in `church_two_agents.json`; validate X/Y/materials after.
- Site history: X12 (committed) → X42 → X72 → X102 → X132 →
  (132, -60, -1); restarts now resume instead of wiping, so no move
  needed until the church completes.
- Score: `python3 /tmp/analyze_runs.py [bot...]`. Compare passes,
  placed/failed, levels done, redirects/escalations, failure reasons,
  model-vs-truth memory across run ids. Keep what moves levels/hour;
  revert what only adds text.

## 8. Next strategy (queued)

- N1. Split levels across bots (`level % agent_count === count_id`) so
  the pair never touches the same block — kills races and cross-bot
  door wars at the root; global all-complete still ends the run.
- N2. Door discipline: never place an upper half (it arrives with the
  lower); never break a cell whose actual block is a door part.
- N3. Disable `unstuck` for blueprint tasks (interrupts + wanders mid-pass).
- N4. Regression logging: a level clean at verify but dirty next scan logs
  the exact coords — names the next oscillator if one survives N1–N3.
- N5. Move blueprint north; user runs from there.

## 9. Session log (intent, actions, handoff — read this to continue)

Intent: make tiny local models (Andy-4 micro, Gemma 12B no-think, 16 GB
Mac Mini) build `church_two_agent` by hand, as normal players (no admin
commands of any sort), with every claim backed by logs. Never strip chat
or history — they are the observability. Prefer redirect-over-block
(micro models loop on errors), probe every change with mocks in
`/tmp/blueprint_probe.mjs`, score every run with `/tmp/analyze_runs.py`,
keep changes small + commented so losers can be reverted.
Standing user rules: ask before editing repo files (blanket approval was
given mid-session for this blueprint workstream); do not touch
`src/agent/tasks/tasks.js` `/fill-for-setblock` style edits unasked (an
old reverted incident — predates this session).

What was done, in order: diagnosed dirt-house runs (R1–R3) → fixed goal
plumbing + compact explain (C2–C3) → added deterministic builder (C4) →
blocked `!newAction` (C5, backfired, reverted) → rerouted it instead (C7,
church completed via `/setblock`) → user: strictly no build commands →
hand-build rewrite + torch/skin/mode fixes (C12–C14) → blind-task safety
(C15) → killed chat loop + distractor commands (C16–C17) → per-block
isolation, stuck-skip, escalation (C18–C20) → static memory + profile
tune + narrowed docs + experiment harness (C22–C25) → level split, door
discipline, unstuck off, regression log (N1–N4) → support gate, no-dig
nav, fly-to, wiper removal (C26–C29) → occupancy skip + parking (C30–C31)
→ full no-commands audit incl. setup/teleport/skin/setMode (C32–C33) →
parking-outside + occupied-not-stuck (C34–C35).

Latest state (01:19 run, Z-1 site): STALLED, fully diagnosed. andy1 has
L0 at ~74/76; the last cells skip every pass with `(1 skipped: andy2 in
the way)`; andy2 waits (L1 gated on L0) and never re-parks, so it camps
L0 forever. Root: park-once flag + random drift back on site.
Next session, in order: (1) re-park on EVERY wait when inside footprint
bounds (drop once-flag, keep fixed outside spot); (2) disable
`item_collecting` + `elbow_room` for blueprint tasks (idle drift onto
the build); (3) re-run SAME site (resumes; do not move, do not wipe);
(4) score with analyzer, expect L0→pipeline→15/15.
WARNING: `/tmp/analyze_runs.py` and `/tmp/blueprint_probe.mjs` die with
`/tmp` — copy into the repo (e.g. `scripts/`) if they prove their keep.
Run command + protocol: see §7. Model/ram constraints: §1.

## 10. Session close-out (2026-11-21 ~01:30, verified from logs)

Final run 182653/55 (01:19–01:25, Z-1 site, C34/C35 live): andy1 98
passes / 3 placed / 3 failed / **occupied=118**, `skipped:` in history
89x, never abandoned (C34 held — zero `failed 3+ times`); andy2 0 passes
/ 576 waiting. Truth frozen at 3/15 (the 3 empty levels) working on L0.
andy2 camped L0's last cell(s) the whole run; parking did not move it
away (flyTo may have failed silently, or elbow_room/item_collecting
drifted it back — park-once flag never retried). andy2's memory is still
pure fantasy (`15x15 oak house... 14 stairs`); temp-0 did not fix
confabulation content, only determinism.

Everything done this session, net: goal plumbing fixed (R1); prompts
made micro-sized (SOP-first, compact explain, static memory, 9 docs,
temp-0/terse/16k profiles); deterministic hand-builder behind rerouted
`!newAction` with per-block isolation, verify, stuck-skip, support gate,
split ranges, door discipline; guardrails that redirect-then-escalate
instead of erroring; modes off (torch/unstuck); occupancy skip + parking
(first version); cheat audit to zero slash-commands on the blueprint
path (setup/travel/finish/skills-gates); experiment harness
(`runs.jsonl` + analyzer + probes); 35 logged changes (C1–C35), 19 root
causes (R1–R19). Reverted along the way: blocking `!newAction`
(statue loop), history seeding (ignored), prose-stripping (vetoed).
NOT done (queued next): re-park on every wait while inside footprint;
disable `item_collecting` + `elbow_room` on blueprint tasks; log bot
position on `waiting` events (would have settled the parking question
in one run).

Code state: 14 files modified + 3 untracked (`FINDINGS.md` and
`src/agent/tasks/experiment_log.js` new this session;
`profiles/defaults/_default.json.bak` pre-existing, not mine),
523+/282-, ALL UNCOMMITTED — user never asked to commit.
`/tmp/analyze_runs.py` + `/tmp/blueprint_probe.mjs` still in /tmp (copy
to repo before reboot). Open questions: (1) what wiped 6/15→~0 between
00:47 and 01:08 with zero logged removals (user action or server
rollback?); (2) why parking failed in run 182655 (flyTo vs drift-back).
Resume: re-run same site/command (resumes); score with analyzer.

## 11. Conversation digest (prompts, corrections, handoff)

What the user actually asked, in order — new sessions must honor this,
not just the code sections above.

- "Why dirt house with a blueprint?" → investigation request. Found R1/R2.
- Ran the church command themselves throughout; I never launched runs,
  only analyzed histories + `runs.jsonl` after.
- "Confirmed not an instruction issue, muse builds it" → pivot from
  prompt-fixing to capability scaffolding for small models.
- "Edit everything, Mini has 16GB, no thinking (tok/s)" → blanket
  approval for this workstream; all fixes must be Mini-cheap.
- "Strictly no commands, build by hand" → C12 hand-build rewrite.
- "Don't remove anything from chat" + "don't remove ANY evidence" →
  vetoed prose-stripping mid-implementation; chat/history/memory files
  stay 100% verbatim forever. The `9-44` gibberish run was praised as
  GOOD (self-repair + mutual checking) — preserve that behavior.
- "Too many restrictions?" → resolved as: **normal player, not admin**
  is the one constraint. Creative flight/menu/walk/doors/chat/fight all
  fair game; typed slash-commands out. Round 4 audited to this line.
- "Log everything for the next session" → this file (§9–§11).

Standing rules for any new session: (1) memory rule — ask before
editing repo files (the prior blanket approval does NOT automatically
carry over; confirm first, as the new session correctly did);
(2) never strip chat/history/logs; (3) normal-player-not-admin;
(4) probe with mocks before claiming anything works.

Questions the user never answered (still open): (a) what wiped 6/15→~0
between 00:47 and 01:08 — manual clear or server rollback? (b) gemma1/2
profiles were fixed but NEVER run — all test runs used andy1/andy2 only.
(c) `/tmp/analyze_runs.py` + `/tmp/blueprint_probe.mjs` still unrescued?

New-session checklist: (1) `git status` matches §10 code state;
(2) rescue /tmp scripts into repo FIRST (reboot kills them);
(3) implement queued: re-park every wait inside footprint, disable
`item_collecting` + `elbow_room` on blueprint tasks, log position on
`waiting` events; (4) probe; (5) re-run same site (resumes at ~L0);
(6) score with analyzer; (7) append results here, same format.
