# Final findings — 22 runs, bots hand-building a church (no cheats)

> HISTORICAL (program continued to 37 runs + ship ×3 families). For the
> current strategy, read [`STRATEGY.md`](./STRATEGY.md) instead; per-run
> evidence lives in `runs/1.md`–`runs/37.md`.

One-line lessons. Evidence: `STRATEGIES.md` + `runs/1.md`–`runs/22.md`.

## WORKED (all in the final code)

Technique: Goal text carries the blueprint. Bots only do what the goal points at. (Run 2)
Technique: One engine command plans everything; the model just keeps pressing it. (Run 3)
Technique: Hand-place every block in isolation — one failure can't kill the level. (Run 3)
Technique: 3-strikes skip — zero progress 3× means move on, come back later. (Runs 3, 10)
Technique: Redirect distractions ("call !newAction instead"); force-build on the 3rd dodge. (Runs 4, 10)
Technique: No forced bot-to-bot chat — every chat turn is a turn not building. (Run 4)
Technique: Short docs + fixed status line — small models drown in long context. (Run 4)
Technique: Never wipe progress on restart. (Run 5)
Technique: No digging while traveling — shortcuts through the church aren't shortcuts. (Run 5)
Technique: Fly to unreachable/high cells (added: also when 4+ above). (Runs 5, 12)
Technique: Place only the door's bottom half; the game adds the top. Unblocked L3 → L12. (Run 6)
Technique: Idle bots re-park off the site so they stop blocking each other. (Run 7)
Technique: Background autopilot off during builds (no wandering, no stray torches). (Runs 7, 13)
Technique: Cells blocked by the other bot count toward the skip rule. (Run 7)
Technique: Cap torches at 4, clear extras — one stray torch fails an air level. (Runs 7, 12)
Technique: Abandon hung navigation after 30s; never call stop() (it poisons the next trip). (Runs 9–10)
Technique: Try all six faces per placement — one guess used to decide the cell. Killed an 8-run stuck cell. (Run 11)
Technique: Re-assert autopilot-off every pass and spawn — respawns reopen the litter window. (Run 13)
Technique: 30s timeout on every wait (dig/place/equip/look), not just walking. (Run 17)

## FAILED

Technique: Blocking commands with errors — small models loop on errors 60×. Redirect instead.
Technique: Fake example chats — small models don't imitate history.
Technique: Bots taking turns / waiting on each other — one slow bot froze everything. Both grind the same level instead.
Technique: Skipping blocked cells without counting — infinite retries. Counted skips work.
Technique: stop() on hung trips — poisoned the next trip (99% → 82%). Abandon instead. (Run 8)
Technique: One flight per level instead of per block — fast early, then stranded out of reach at L4. (Run 21)
Not fixable in code (luck): model-backend stalls, server-path stalls. Bound the wait, survive them. (Runs 15–18)
Vetoed untested: deleting chat/history, any build cheat command.

## THE STACK

The final code is every winner above stacked — each owns a different failure, so they add up. Price: ~8s/pass
(run 11, thin) → ~100s/pass (run 19, full). It never broke; it got too careful to finish in 15 min.
Best ever: andy validator-100% (run 11), truth 14/15 (run 10); muse 9/15 (runs 20, 22 — API cadence).
Untested next: longer windows, proximity-guarded fly (fly iff the next cell is out of reach), endgame last-block push.
