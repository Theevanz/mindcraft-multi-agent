import * as skills from '../library/skills.js';
import * as world from '../library/world.js';
import settings from '../settings.js';
import convoManager from '../conversation.js';
import { logRunEvent } from '../tasks/experiment_log.js';
import { Vec3 } from 'vec3';


export function hasBlueprintBuild(agent) {
    return !!agent.task && agent.task.task_type === 'construction' && !!agent.task.blueprint &&
        !(agent.task.blocked_actions || []).includes('!checkBlueprintLevel');
}

async function blueprintRedirect(agent, label) {
    agent.blueprint_dodge_count = (agent.blueprint_dodge_count || 0) + 1;
    if (agent.blueprint_dodge_count >= 3) {
        agent.blueprint_dodge_count = 0;
        let result = '';
        await agent.actions.runAction(label, async () => { result = await buildNextBlueprintLevel(agent); }, {});
        logRunEvent(agent, 'escalation', { label, pos: botPos(agent) });
        return `You keep avoiding the build, so building instead. ${result}`;
    }
    logRunEvent(agent, 'redirect', { label, dodge: agent.blueprint_dodge_count, pos: botPos(agent) });
    return 'Not needed for the blueprint build. Call !newAction("Build the next blueprint level") instead.';
}

export async function flyNearIfNeeded(agent, x, y, z) {
    const bot = agent.bot;
    if (bot.game?.gameMode !== 'creative' || !bot.creative) return;
    const p = bot.entity.position;
    const dist = Math.sqrt((p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2);
    // A target 2+ above is unclimbable on foot without pillaring (noDig
    // forbids), even when 3D-close (run 34: gemma2 stranded 4+ min in the
    // gap<4 dead zone). Fly the vertical gap; walk only level-or-1-up.
    if (dist < 10 && (y - p.y) < 2) return;
    try {
        // Run 24: startFlying was the last unraced await in the build path
        // (run-23 freeze suspect) — race it like flyTo; timeout walks.
        await Promise.race([
            bot.creative.startFlying(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('startFlying timeout')), 8000))
        ]);
        await Promise.race([
            bot.creative.flyTo(new Vec3(x, y + 2, z)),
            new Promise((_, rej) => setTimeout(() => rej(new Error('fly timeout')), 8000))
        ]);
    } catch (e) { console.warn(`[bound] fly failed (${e.message}) — walking`); }
}

export async function parkAwayFromSite(agent) {
    // Re-park on EVERY wait while inside the footprint (no once-flag: the
    // 01:19 run camped L0 forever because the flag never retried and idle
    // drift walked the bot back onto the build). Already-clear bots hold.
    try {
        const levels = agent.task.blueprint.data.levels;
        let minX = Infinity, minZ = Infinity, y = levels[0].coordinates[1];
        let sizeX = 10, sizeZ = 12;
        for (const l of levels) {
            minX = Math.min(minX, l.coordinates[0]);
            minZ = Math.min(minZ, l.coordinates[2]);
            if (l.placement?.length) {
                sizeZ = Math.max(sizeZ, l.placement.length);
                for (const row of l.placement) sizeX = Math.max(sizeX, row.length);
            }
        }
        const bot = agent.bot;
        const p = bot.entity?.position;
        if (p && (p.x < minX - 1 || p.x > minX + sizeX + 1 || p.z < minZ - 1 || p.z > minZ + sizeZ + 1))
            return; // already clear of the build: hold position
        agent.blueprint_parked = true;
        const spot = new Vec3(minX - 4, y, minZ);
        if (bot.game?.gameMode === 'creative' && bot.creative) {
            // Run 24: race startFlying too (run-23 freeze suspect).
            await Promise.race([
                bot.creative.startFlying(),
                new Promise((_, rej) => setTimeout(() => rej(new Error('startFlying timeout')), 8000))
            ]);
            await Promise.race([
                bot.creative.flyTo(spot),
                new Promise((_, rej) => setTimeout(() => rej(new Error('park timeout')), 15000))
            ]);
        } else {
            await skills.goToPosition(bot, spot.x, spot.y, spot.z);
        }
    } catch (e) {
        // 14:41 run: 120 waitings, bot never moved, zero evidence. Log it.
        logRunEvent(agent, 'park_failed', { error: String(e.message || e).slice(0, 120) });
    }
}

export function playerBlockingCell(agent, x, y, z) {
    try {
        const bot = agent.bot;
        const target = new Vec3(x + 0.5, y + 0.5, z + 0.5);
        // Radius 8 prefilter (was 4): a camper 2.6 from the cell can sit 5+
        // from the placer and still block it (run 35) — the 1.8/column tests
        // below stay the real gate.
        for (const e of world.getNearbyEntities(bot, 8)) {
            if (e.type !== 'player') continue;
            if (bot.entity && e.id === bot.entity.id) continue;
            if (e.position.distanceTo(target) < 1.8) return e.username || 'a player';
            if (skills.bodyBlocksCell(e.position, [x, y, z])) return e.username || 'a player';
        }
    } catch (e) { /* fail open: attempt the op */ }
    return null;
}

function lastBotOutputLine(bot, fromLen) {
    const added = bot.output.slice(fromLen).split('\n').map(s => s.trim()).filter(Boolean);
    return added.length ? added[added.length - 1] : '';
}

function botPos(agent) {
    try {
        const p = agent.bot?.entity?.position;
        return p ? [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)] : null;
    } catch (e) { return null; }
}

async function runBlueprintGuardedAction(agent, label, actionFn, opts) {
    const code_return = await agent.actions.runAction(label, actionFn, opts);
    if (code_return.interrupted && !code_return.timedout)
        return;
    return code_return.message;
}

export function biasSide(agent) {
    // Run 23–24: soft spatial split — even count_id owns the low-X half,
    // odd the high-X half. Partition with fallback, never hard ownership.
    try {
        return (((agent && agent.count_id) || 0) % 2 === 0) ? 'low' : 'high';
    } catch (e) { return '-'; }
}

export function footprintMidX(agent, levelNum) {
    // Midpoint X of the level footprint from blueprint data (never hardcoded).
    // Null when unreadable — callers fail open to shared-lowest.
    try {
        const levels = agent.task && agent.task.blueprint && agent.task.blueprint.data.levels;
        const level = levels && levels[levelNum];
        const rows = level && level.placement;
        if (!rows || !rows.length) return null;
        let width = 0;
        for (const row of rows) width = Math.max(width, row.length);
        return level.coordinates[0] + width / 2;
    } catch (e) { return null; }
}

export function biasSplitHalves(agent, levelNum, cells) {
    // Run 24: split cells into own/other halves. Fail open returns everything
    // as own (shared-lowest), so a mis-split bot never idles — no 14:41.
    const midX = footprintMidX(agent, levelNum);
    if (midX === null || !cells.length) return { own: cells, other: [] };
    const wantLow = biasSide(agent) === 'low';
    const own = [], other = [];
    for (const m of cells) {
        if ((m.coordinates[0] < midX) === wantLow) own.push(m);
        else other.push(m);
    }
    return { own, other };
}

export function findVacateSpot(agent, c) {
    // Run 34: grounded vacate target — standable (solid below, air feet+head),
    // ≥2.5 from the failed cell, clear of the partner; farthest-from-cell wins
    // ("out of the way"). Radius 6 bounds the walk cost. Null when none.
    try {
        const bot = agent.bot;
        const p = bot.entity?.position;
        if (!p) return null;
        const solidBelow = (b) => b && (b.boundingBox === 'block' || (b.boundingBox === undefined && !['air', 'water', 'lava'].includes(b.name)));
        const openAt = (b) => b && (b.boundingBox === 'empty' || b.name === 'air');
        const fx = Math.floor(p.x), fy = Math.floor(p.y), fz = Math.floor(p.z);
        const cands = [];
        for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) {
            if (dx === 0 && dz === 0) continue;
            for (let dy = -1; dy <= 1; dy++) {
                const x = fx + dx, y = fy + dy, z = fz + dz;
                const dCell = Math.hypot(x + 0.5 - (c[0] + 0.5), z + 0.5 - (c[2] + 0.5));
                if (dCell < 2.5) continue;
                const below = bot.blockAt(new Vec3(x, y - 1, z));
                const feet = bot.blockAt(new Vec3(x, y, z));
                const head = bot.blockAt(new Vec3(x, y + 1, z));
                if (!solidBelow(below) || !openAt(feet) || !head || head.name !== 'air') continue;
                if (playerBlockingCell(agent, x, y, z)) continue; // partner stands there
                cands.push({ x, y, z, d: dCell });
            }
        }
        if (!cands.length) return null;
        cands.sort((a, b) => b.d - a.d);
        return cands[0];
    } catch (e) { return null; }
}

export async function vacateCell(agent, c) {
    // Run 34: grounded vacate — walk to a standable spot out of the way; fly
    // (to the same spot, then land) only when the walk fails or no spot
    // exists. True if the bot moved by either.
    const bot = agent.bot;
    const spot = findVacateSpot(agent, c);
    if (spot) {
        try {
            if (await skills.goToPosition(bot, spot.x, spot.y, spot.z, 2)) return true;
        } catch (e) { /* fall through to fly-to-spot */ }
        try {
            if (bot.game?.gameMode === 'creative' && bot.creative) {
                await bot.creative.startFlying();
                await Promise.race([
                    bot.creative.flyTo(new Vec3(spot.x, spot.y + 1, spot.z)),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('vacate fly timeout')), 8000))
                ]);
                skills.landIfFlying(bot);
                return true;
            }
        } catch (e) { return false; }
        return false;
    }
    const p = bot.entity?.position;
    if (!p) return false;
    if (bot.game?.gameMode !== 'creative' || !bot.creative) return false;
    try {
        const dx = (p.x - (c[0] + 0.5)) || 1;
        const dz = (p.z - (c[2] + 0.5)) || 1;
        const len = Math.hypot(dx, dz);
        await bot.creative.startFlying();
        await Promise.race([
            bot.creative.flyTo(new Vec3(p.x + (dx / len) * 4, p.y + 1, p.z + (dz / len) * 4)),
            new Promise((_, rej) => setTimeout(() => rej(new Error('vacate fly timeout')), 8000))
        ]);
        skills.landIfFlying(bot);
        return true;
    } catch (e) { return false; }
}

async function buildLevelFixes(agent, levelNum, mismatches) {
    // Hand-building only: clear wrong blocks first, then place by hand.
    // dontCheat=true guarantees physical placement, never server cheat commands.
    // Doors are placed once; the game creates both halves.
    // Each block is isolated: one failure never aborts the level.
    agent.bot.noDigNavigate = true;
    const side = biasSide(agent);
    // Run 33: per-cell strike memory (pruned to current mismatches — fixed
    // cells forgive). 2 strikes vacate + defer for the rest of the pass, then
    // retry fresh (threshold 2, not 3, so lone rem=1 cells vacate BEFORE level
    // stuck-skip at 3 eats the pass).
    agent.blueprint_cell_fails = agent.blueprint_cell_fails || {};
    const stillBad = new Set(mismatches.map(m => m.coordinates.join(',')));
    for (const k of Object.keys(agent.blueprint_cell_fails)) {
        if (!stillBad.has(k)) delete agent.blueprint_cell_fails[k];
    }
    let vacated = 0;
    let placed = 0;
    let failed = 0;
    let skippedDoors = 0;
    let occupied = 0;
    let occupiedWho = '';
    const failures = [];
    const levels = agent.task.blueprint.data.levels;
    // Run 24: conditional help — work only my half; touch the other half
    // solely when mine is clean (none of my cells mismatched this pass).
    // Takeover latency if a bot dies is one pass; no waiting, no 14:41.
    const rems = biasSplitHalves(agent, levelNum, mismatches.filter(m => m.expected === 'air'));
    const plcs = biasSplitHalves(agent, levelNum, mismatches.filter(m => m.expected !== 'air'));
    const helping = (rems.own.length + plcs.own.length) === 0 && (rems.other.length + plcs.other.length) > 0;
    const removals = helping ? rems.other : rems.own;
    const placements = helping ? plcs.other : plcs.own;
    for (const m of removals) {
        const c = m.coordinates;
        if ((m.actual || '').includes('door')) { skippedDoors++; continue; } // breaking a door half cascades; leave it
        const rStrikes = agent.blueprint_cell_fails[c.join(',')] || 0;
        if (rStrikes >= 2) {
            // Run 34: vacate then RETRY from the new spot in the same pass
            // (no deferral wait); strikes reset so the retry counts fresh.
            await vacateCell(agent, c);
            agent.blueprint_cell_fails[c.join(',')] = 0;
            vacated++;
        }
        const blockerR = playerBlockingCell(agent, c[0], c[1], c[2]);
        // Run 36: occupancy counts as a strike (drives vacate — a camper that
        // never moves must displace, not defer forever).
        if (blockerR) { occupied++; occupiedWho = blockerR; agent.blueprint_cell_fails[c.join(',')] = (agent.blueprint_cell_fails[c.join(',')] || 0) + 1; continue; }
        await flyNearIfNeeded(agent, c[0], c[1], c[2]);
        const mark = agent.bot.output.length;
        try {
            if (await skills.breakBlockAt(agent.bot, c[0], c[1], c[2])) placed++;
            else {
                failed++;
                const rReason = lastBotOutputLine(agent.bot, mark);
                failures.push(`clear ${c}: ${rReason}`);
                if (!rReason.includes('already at')) agent.blueprint_cell_fails[c.join(',')] = (agent.blueprint_cell_fails[c.join(',')] || 0) + 1;
            }
        } catch (e) { failed++; failures.push(`clear ${c}: threw ${e.message}`); agent.blueprint_cell_fails[c.join(',')] = (agent.blueprint_cell_fails[c.join(',')] || 0) + 1; }
    }
    for (const m of placements) {
        const c = m.coordinates;
        if (isUpperDoorHalf(levels, levelNum, c[0], c[2], m.expected)) { skippedDoors++; continue; } // upper half arrives with the lower
        const pStrikes = agent.blueprint_cell_fails[c.join(',')] || 0;
        if (pStrikes >= 2) {
            // Run 34: vacate then RETRY from the new spot in the same pass.
            await vacateCell(agent, c);
            agent.blueprint_cell_fails[c.join(',')] = 0;
            vacated++;
        }
        const blockerP = playerBlockingCell(agent, c[0], c[1], c[2]);
        // Run 36: occupancy counts as a strike (see above).
        if (blockerP) { occupied++; occupiedWho = blockerP; agent.blueprint_cell_fails[c.join(',')] = (agent.blueprint_cell_fails[c.join(',')] || 0) + 1; continue; }
        await flyNearIfNeeded(agent, c[0], c[1], c[2]);
        const mark = agent.bot.output.length;
        const side = m.expected.includes('torch') ? 'side' : 'bottom';
        try {
            if (await skills.placeBlock(agent.bot, m.expected, c[0], c[1], c[2], side, true)) placed++;
            else {
                failed++;
                const pReason = lastBotOutputLine(agent.bot, mark);
                failures.push(`${m.expected} at ${c}: ${pReason}`);
                if (!pReason.includes('already at')) agent.blueprint_cell_fails[c.join(',')] = (agent.blueprint_cell_fails[c.join(',')] || 0) + 1;
            }
        } catch (e) { failed++; failures.push(`${m.expected} at ${c}: threw ${e.message}`); agent.blueprint_cell_fails[c.join(',')] = (agent.blueprint_cell_fails[c.join(',')] || 0) + 1; }
    }
    await new Promise(r => setTimeout(r, 500));
    let remaining = -1;
    try {
        remaining = agent.task.blueprint.checkLevel(agent.bot, levelNum).mismatches.length;
    } catch (e) {
        agent.bot.noDigNavigate = false;
        return { message: `Worked on level ${levelNum} but could not verify: ${e.message}`, placed, remaining, occupied, vacated };
    }
    const failNote = failures.length ? ` Failures: ${failures.slice(0, 3).join(' | ')}` : '';
    const doorNote = skippedDoors ? ` (${skippedDoors} door halves deferred)` : '';
    const occNote = occupied ? ` (${occupied} skipped: ${occupiedWho} in the way)` : '';
    let out;
    if (remaining === 0)
        out = { message: `Level ${levelNum} complete. Move to level ${levelNum + 1} with !checkBlueprintLevel(${levelNum + 1}).${doorNote}`, placed, remaining, occupied, vacated };
    else if (placed === 0)
        out = { message: `Level ${levelNum}: could not place anything, ${remaining} still need fixes.${failNote}${doorNote}${occNote}`, placed, remaining, occupied, vacated };
    else
        out = { message: `Level ${levelNum}: placed ${placed} blocks (${failed} failed), ${remaining} still need fixes. Call !newAction("Build the next blueprint level") to continue.${failNote}${doorNote}${occNote}`, placed, remaining, occupied, vacated };
    logRunEvent(agent, 'build_pass', { level: levelNum, placed, failed, remaining, skippedDoors, occupied, failures: failures.slice(0, 3), pos: botPos(agent), side, helping, vacated });
    agent.bot.noDigNavigate = false;
    return out;
}

export function isUpperDoorHalf(levels, n, x, z, expected) {
    if (!expected.includes('door') || n === 0) return false;
    const prev = levels[n - 1];
    const bx = x - prev.coordinates[0];
    const bz = z - prev.coordinates[2];
    const row = prev.placement[bz];
    return !!row && !!row[bx] && row[bx].includes('door');
}

export async function stallCheck(agent, placed, levelNum, idleMs = 300000) {
    // Run 37: re-log failsafe — zero placements for 5+ minutes means the
    // SESSION is wedged (desync/embed/effects/strand, run 36), not the level:
    // restart into a fresh session/entity/position (supervisor resumes).
    // Capped at 3 per run, then flow as before (no wedge). Time-based so it
    // covers the all-skipped loop (no passes) and all cadences equally.
    const nowMs = Date.now();
    agent.blueprint_last_placed_at = agent.blueprint_last_placed_at || nowMs;
    agent.blueprint_relogs = agent.blueprint_relogs || 0;
    if (placed > 0) {
        agent.blueprint_last_placed_at = nowMs;
        return;
    }
    if (nowMs - agent.blueprint_last_placed_at > idleMs && agent.blueprint_relogs < 3) {
        agent.blueprint_relogs++;
        logRunEvent(agent, 'stall_relog', { level: levelNum, pos: botPos(agent) });
        try {
            await agent.cleanKill(`Stall: zero placements for 5+ min (L${levelNum}). Restarting.`, 1);
        } catch (e) { process.exit(1); }
    }
}

async function buildNextBlueprintLevel(agent) {
    // Re-assert mode suppression every pass: (re)spawns and model !setMode
    // calls re-enable litter/drift modes that dirty air-trivial levels.
    if (agent.bot.modes) {
        for (const m of ['unstuck', 'item_collecting', 'elbow_room', 'torch_placing'])
            agent.bot.modes.setOn(m, false);
    }
    const blueprint = agent.task.blueprint;
    const numLevels = blueprint.data.levels.length;
    agent.blueprint_stuck = agent.blueprint_stuck || {};
    agent.blueprint_clean = agent.blueprint_clean || {};
    const results = [];
    for (let n = 0; n < numLevels; n++) {
        try {
            results[n] = blueprint.checkLevel(agent.bot, n);
        } catch (e) {
            results[n] = null;
        }
        if (results[n] && results[n].mismatches.length === 0) {
            agent.blueprint_clean[n] = true;
            continue;
        }
        if (results[n] && agent.blueprint_clean[n]) {
            agent.blueprint_clean[n] = false;
            logRunEvent(agent, 'regression', { level: n, coords: results[n].mismatches.slice(0, 5).map(m => m.coordinates) });
        }
    }
    if (!results.some((r, n) => r && r.mismatches.length > 0) && results.every(Boolean))
        return 'Blueprint complete! All levels match. Call !checkBlueprint to confirm.';
    // BOTH bots grind the lowest incomplete level. No split, no support-gate
    // wait: unbuildable cells fail honestly, feed the stuck counter, and
    // stuck-skip flows the pipeline upward instead of waiting.
    // Occupied-only passes count as stuck too: a camped cell is skipped past
    // after 3 passes, not retried forever.
    for (let n = 0; n < numLevels; n++) {
        if (!results[n] || results[n].mismatches.length === 0)
            continue;
        if ((agent.blueprint_stuck[n] || 0) >= 3)
            continue; // zero progress 3+ times: skip for now so one bad block can't wedge the build
        const r = await buildLevelFixes(agent, n, results[n].mismatches);
        // Run 37: re-log failsafe (time-barren, not displacement — the wedge
        // shape is the all-skipped loop, which runs no passes at all).
        await stallCheck(agent, r.placed, n);
        // Run 34: vacate passes don't count as stuck (repositioning, not dead)
        // up to 2 vacate rounds per level — then flow as before (no wedge).
        agent.blueprint_vacate_rounds = agent.blueprint_vacate_rounds || {};
        if (r.placed > 0) { agent.blueprint_stuck[n] = 0; agent.blueprint_vacate_rounds[n] = 0; agent.blueprint_parked = false; }
        else if ((r.vacated || 0) > 0 && (agent.blueprint_vacate_rounds[n] || 0) < 2) { agent.blueprint_vacate_rounds[n] = (agent.blueprint_vacate_rounds[n] || 0) + 1; agent.blueprint_stuck[n] = 0; }
        else agent.blueprint_stuck[n] = (agent.blueprint_stuck[n] || 0) + 1;
        return r.message;
    }
    for (let n = 0; n < numLevels; n++) {
        if (!results[n] || results[n].mismatches.length > 0) {
            await stallCheck(agent, 0, n); // all-skipped loop still stalls
            return `Level ${n} failed 3+ times with zero placements. Check the failure reasons above or clear the site by hand.`;
        }
    }
    await parkAwayFromSite(agent);
    return 'My levels are done for now. Waiting on the other builder...';
}

function runAsAction (actionFn, resume = false, timeout = -1) {
    let actionLabel = null;  // Will be set on first use
    
    const wrappedAction = async function (agent, ...args) {
        // Set actionLabel only once, when the action is first created
        if (!actionLabel) {
            const actionObj = actionsList.find(a => a.perform === wrappedAction);
            actionLabel = actionObj.name.substring(1); // Remove the ! prefix
        }

        const actionFnWithAgent = async () => {
            await actionFn(agent, ...args);
        };
        const code_return = await agent.actions.runAction(`action:${actionLabel}`, actionFnWithAgent, { timeout, resume });
        if (code_return.interrupted && !code_return.timedout)
            return;
        return code_return.message;
    }

    return wrappedAction;
}

export const actionsList = [
    {
        name: '!newAction',
        description: 'Perform new and unknown custom behaviors that are not available as a command.', 
        params: {
            'prompt': { type: 'string', description: 'A natural language prompt to guide code generation. Make a detailed step-by-step plan.' }
        },
        perform: async function(agent, prompt) {
            // On blueprint tasks, small models spam !newAction instead of the
            // blueprint commands. Harness that: build the next level directly.
            if (hasBlueprintBuild(agent)) {
                agent.blueprint_dodge_count = 0;
                let result = "";
                const actionFn = async () => {
                    try {
                        result = await buildNextBlueprintLevel(agent);
                    } catch (e) {
                        result = 'Error building blueprint level: ' + e.toString();
                    }
                };
                await agent.actions.runAction('action:newAction', actionFn, {timeout: settings.code_timeout_mins});
                return result;
            }
            // just ignore prompt - it is now in context in chat history
            if (!settings.allow_insecure_coding) { 
                agent.openChat('newAction is disabled. Enable with allow_insecure_coding=true in settings.js');
                return "newAction not allowed! Code writing is disabled in settings. Notify the user.";
            }
            let result = "";
            const actionFn = async () => {
                try {
                    result = await agent.coder.generateCode(agent.history);
                } catch (e) {
                    result = 'Error generating code: ' + e.toString();
                }
            };
            await agent.actions.runAction('action:newAction', actionFn, {timeout: settings.code_timeout_mins});
            return result;
        }
    },
    {
        name: '!stop',
        description: 'Force stop all actions and commands that are currently executing.',
        perform: async function (agent) {
            await agent.actions.stop();
            agent.clearBotLogs();
            agent.actions.cancelResume();
            agent.bot.emit('idle');
            let msg = 'Agent stopped.';
            if (agent.self_prompter.isActive())
                msg += ' Self-prompting still active.';
            return msg;
        }
    },
    {
        name: '!stfu',
        description: 'Stop all chatting and self prompting, but continue current action.',
        perform: async function (agent) {
            agent.openChat('Shutting up.');
            agent.shutUp();
            return;
        }
    },
    {
        name: '!restart',
        description: 'Restart the agent process.',
        perform: async function (agent) {
            agent.cleanKill();
        }
    },
    {
        name: '!clearChat',
        description: 'Clear the chat history.',
        perform: async function (agent) {
            agent.history.clear();
            return agent.name + "'s chat history was cleared, starting new conversation from scratch.";
        }
    },
    {
        name: '!goToPlayer',
        description: 'Go to the given player.',
        params: {
            'player_name': {type: 'string', description: 'The name of the player to go to.'},
            'closeness': {type: 'float', description: 'How close to get to the player.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, closeness) => {
            await skills.goToPlayer(agent.bot, player_name, closeness);
        })
    },
    {
        name: '!followPlayer',
        description: 'Endlessly follow the given player.',
        params: {
            'player_name': {type: 'string', description: 'name of the player to follow.'},
            'follow_dist': {type: 'float', description: 'The distance to follow from.', domain: [0, Infinity]}
        },
        perform: async function (agent, player_name, follow_dist) {
            if (hasBlueprintBuild(agent))
                return await blueprintRedirect(agent, 'action:followPlayer');
            return await runBlueprintGuardedAction(agent, 'action:followPlayer', async () => {
                await skills.followPlayer(agent.bot, player_name, follow_dist);
            }, { timeout: -1, resume: true });
        }
    },
    {
        name: '!goToCoordinates',
        description: 'Go to the given x, y, z location.',
        params: {
            'x': {type: 'float', description: 'The x coordinate.', domain: [-Infinity, Infinity]},
            'y': {type: 'float', description: 'The y coordinate.', domain: [-64, 320]},
            'z': {type: 'float', description: 'The z coordinate.', domain: [-Infinity, Infinity]},
            'closeness': {type: 'float', description: 'How close to get to the location.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, x, y, z, closeness) => {
            await skills.goToPosition(agent.bot, x, y, z, closeness);
        })
    },
    {
        name: '!searchForBlock',
        description: 'Find and go to the nearest block of a given type in a given range.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the block. Minimum 32.', domain: [10, 512] }
        },
        perform: async function (agent, block_type, range) {
            if (hasBlueprintBuild(agent))
                return await blueprintRedirect(agent, 'action:searchForBlock');
            return await runBlueprintGuardedAction(agent, 'action:searchForBlock', async () => {
                if (range < 32) {
                    skills.log(agent.bot, `Minimum search range is 32.`);
                    range = 32;
                }
                await skills.goToNearestBlock(agent.bot, block_type, 4, range);
            }, {});
        }
    },
    {
        name: '!searchForEntity',
        description: 'Find and go to the nearest entity of a given type in a given range.',
        params: {
            'type': { type: 'string', description: 'The type of entity to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the entity.', domain: [32, 512] }
        },
        perform: runAsAction(async (agent, entity_type, range) => {
            await skills.goToNearestEntity(agent.bot, entity_type, 4, range);
        })
    },
    {
        name: '!moveAway',
        description: 'Move away from the current location in any direction by a given distance.',
        params: {'distance': { type: 'float', description: 'The distance to move away.', domain: [0, Infinity] }},
        perform: async function (agent, distance) {
            if (hasBlueprintBuild(agent))
                return await blueprintRedirect(agent, 'action:moveAway');
            const actionFn = async () => {
                await skills.moveAway(agent.bot, distance);
            };
            const code_return = await agent.actions.runAction('action:moveAway', actionFn, {});
            if (code_return.interrupted && !code_return.timedout)
                return;
            return code_return.message;
        }
    },
    {
        name: '!rememberHere',
        description: 'Save the current location with a given name.',
        params: {'name': { type: 'string', description: 'The name to remember the location as.' }},
        perform: async function (agent, name) {
            const pos = agent.bot.entity.position;
            agent.memory_bank.rememberPlace(name, pos.x, pos.y, pos.z);
            return `Location saved as "${name}".`;
        }
    },
    {
        name: '!goToRememberedPlace',
        description: 'Go to a saved location.',
        params: {'name': { type: 'string', description: 'The name of the location to go to.' }},
        perform: runAsAction(async (agent, name) => {
            const pos = agent.memory_bank.recallPlace(name);
            if (!pos) {
            skills.log(agent.bot, `No location named "${name}" saved.`);
            return;
            }
            await skills.goToPosition(agent.bot, pos[0], pos[1], pos[2], 1);
        })
    },
    {
        name: '!givePlayer',
        description: 'Give the specified item to the given player.',
        params: { 
            'player_name': { type: 'string', description: 'The name of the player to give the item to.' }, 
            'item_name': { type: 'ItemName', description: 'The name of the item to give.' },
            'num': { type: 'int', description: 'The number of items to give.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: async function (agent, player_name, item_name, num) {
            if (hasBlueprintBuild(agent))
                return await blueprintRedirect(agent, 'action:givePlayer');
            return await runBlueprintGuardedAction(agent, 'action:givePlayer', async () => {
                await skills.giveToPlayer(agent.bot, item_name, player_name, num);
            }, {});
        }
    },
    {
        name: '!consume',
        description: 'Eat/drink the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to consume.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.consume(agent.bot, item_name);
        })
    },
    {
        name: '!equip',
        description: 'Equip the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to equip.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.equip(agent.bot, item_name);
        })
    },
    {
        name: '!putInChest',
        description: 'Put the given item in the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to put in the chest.' },
            'num': { type: 'int', description: 'The number of items to put in the chest.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            await skills.putInChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!takeFromChest',
        description: 'Take the given items from the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to take.' },
            'num': { type: 'int', description: 'The number of items to take.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            await skills.takeFromChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!viewChest',
        description: 'View the items/counts of the nearest chest.',
        params: { },
        perform: runAsAction(async (agent) => {
            await skills.viewChest(agent.bot);
        })
    },
    {
        name: '!discard',
        description: 'Discard the given item from the inventory.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to discard.' },
            'num': { type: 'int', description: 'The number of items to discard.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            const start_loc = agent.bot.entity.position;
            await skills.moveAway(agent.bot, 5);
            await skills.discard(agent.bot, item_name, num);
            await skills.goToPosition(agent.bot, start_loc.x, start_loc.y, start_loc.z, 0);
        })
    },
    {
        name: '!collectBlocks',
        description: 'Collect the nearest blocks of a given type.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to collect.' },
            'num': { type: 'int', description: 'The number of blocks to collect.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: async function (agent, type, num) {
            if (hasBlueprintBuild(agent))
                return await blueprintRedirect(agent, 'action:collectBlocks');
            return await runBlueprintGuardedAction(agent, 'action:collectBlocks', async () => {
                await skills.collectBlock(agent.bot, type, num);
            }, { timeout: 10, resume: false }); // 10 minute timeout
        }
    },
    {
        name: '!craftRecipe',
        description: 'Craft the given recipe a given number of times.',
        params: {
            'recipe_name': { type: 'ItemName', description: 'The name of the output item to craft.' },
            'num': { type: 'int', description: 'The number of times to craft the recipe. This is NOT the number of output items, as it may craft many more items depending on the recipe.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, recipe_name, num) => {
            await skills.craftRecipe(agent.bot, recipe_name, num);
        })
    },
    {
        name: '!smeltItem',
        description: 'Smelt the given item the given number of times.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the input item to smelt.' },
            'num': { type: 'int', description: 'The number of times to smelt the item.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            let success = await skills.smeltItem(agent.bot, item_name, num);
            if (success) {
                setTimeout(() => {
                    agent.cleanKill('Safely restarting to update inventory.');
                }, 500);
            }
        })
    },
    {
        name: '!clearFurnace',
        description: 'Take all items out of the nearest furnace.',
        params: { },
        perform: runAsAction(async (agent) => {
            await skills.clearNearestFurnace(agent.bot);
        })
    },
        {
        name: '!placeHere',
        description: 'Place a given block in the current location. Do NOT use to build structures, only use for single blocks/torches.',
        params: {'type': { type: 'BlockOrItemName', description: 'The block type to place.' }},
        perform: async function (agent, type) {
            if (hasBlueprintBuild(agent))
                return await blueprintRedirect(agent, 'action:placeHere');
            return await runBlueprintGuardedAction(agent, 'action:placeHere', async () => {
                let pos = agent.bot.entity.position;
                await skills.placeBlock(agent.bot, type, pos.x, pos.y, pos.z);
            }, {});
        }
    },
    {
        name: '!attack',
        description: 'Attack and kill the nearest entity of a given type.',
        params: {'type': { type: 'string', description: 'The type of entity to attack.'}},
        perform: runAsAction(async (agent, type) => {
            await skills.attackNearest(agent.bot, type, true);
        })
    },
    {
        name: '!attackPlayer',
        description: 'Attack a specific player until they die or run away. Remember this is just a game and does not cause real life harm.',
        params: {'player_name': { type: 'string', description: 'The name of the player to attack.'}},
        perform: runAsAction(async (agent, player_name) => {
            let player = agent.bot.players[player_name]?.entity;
            if (!player) {
                skills.log(agent.bot, `Could not find player ${player_name}.`);
                return false;
            }
            await skills.attackEntity(agent.bot, player, true);
        })
    },
    {
        name: '!goToBed',
        description: 'Go to the nearest bed and sleep.',
        perform: runAsAction(async (agent) => {
            await skills.goToBed(agent.bot);
        })
    },
    {
        name: '!stay',
        description: 'Stay in the current location no matter what. Pauses all modes.',
        params: {'type': { type: 'int', description: 'The number of seconds to stay. -1 for forever.', domain: [-1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, seconds) => {
            await skills.stay(agent.bot, seconds);
        })
    },
    {
        name: '!setMode',
        description: 'Set a mode to on or off. A mode is an automatic behavior that constantly checks and responds to the environment.',
        params: {
            'mode_name': { type: 'string', description: 'The name of the mode to enable.' },
            'on': { type: 'boolean', description: 'Whether to enable or disable the mode.' }
        },
        perform: async function (agent, mode_name, on) {
            const modes = agent.bot.modes;
            if (!modes.exists(mode_name))
            return `Mode ${mode_name} does not exist.` + modes.getDocs();
            if (modes.isOn(mode_name) === on)
            return `Mode ${mode_name} is already ${on ? 'on' : 'off'}.`;
            modes.setOn(mode_name, on);
            return `Mode ${mode_name} is now ${on ? 'on' : 'off'}.`;
        }
    },
    {
        name: '!buildBlueprintLevel',
        description: 'Build one blueprint level by hand, block by block, from inventory. Use instead of writing code. Call !checkBlueprintLevel(n) first, then this, then !checkBlueprintLevel(n) again.',
        params: {
            'levelNum': { type: 'int', description: 'The blueprint level number to build.', domain: [0, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, levelNum) => {
            const blueprint = agent.task?.blueprint;
            if (!blueprint)
                return 'No blueprint loaded for this task.';
            const numLevels = blueprint.data.levels.length;
            if (levelNum < 0 || levelNum >= numLevels)
                return `Level ${levelNum} does not exist. There are ${numLevels} levels (0-${numLevels - 1}).`;
            let result;
            try {
                result = blueprint.checkLevel(agent.bot, levelNum);
            } catch (e) {
                return `Could not check level ${levelNum}: ${e.message}`;
            }
            agent.blueprint_dodge_count = 0;
            if (result.mismatches.length === 0)
                return `Level ${levelNum} is already complete. Move to level ${levelNum + 1}.`;
            const r = await buildLevelFixes(agent, levelNum, result.mismatches);
            skills.log(agent.bot, r.message);
            return r.message;
        })
    },
    {
        name: '!goal',
        description: 'Set a goal prompt to endlessly work towards with continuous self-prompting.',
        params: {
            'selfPrompt': { type: 'string', description: 'The goal prompt.' },
        },
        perform: async function (agent, prompt) {
            if (convoManager.inConversation()) {
                agent.self_prompter.setPromptPaused(prompt);
            }
            else {
                agent.self_prompter.start(prompt);
            }
        }
    },
    {
        name: '!endGoal',
        description: 'Call when you have accomplished your goal. It will stop self-prompting and the current action. ',
        perform: async function (agent) {
            agent.self_prompter.stop();
            return 'Self-prompting stopped.';
        }
    },
    {
        name: '!showVillagerTrades',
        description: 'Show trades of a specified villager.',
        params: {'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' }},
        perform: runAsAction(async (agent, id) => {
            await skills.showVillagerTrades(agent.bot, id);
        })
    },
    {
        name: '!tradeWithVillager',
        description: 'Trade with a specified villager.',
        params: {
            'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' },
            'index': { type: 'int', description: 'The index of the trade you want executed (1-indexed).', domain: [1, Number.MAX_SAFE_INTEGER] },
            'count': { type: 'int', description: 'How many times that trade should be executed.', domain: [1, Number.MAX_SAFE_INTEGER] },
        },
        perform: runAsAction(async (agent, id, index, count) => {
            await skills.tradeWithVillager(agent.bot, id, index, count);
        })
    },
    {
        name: '!startConversation',
        description: 'Start a conversation with a bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to send the message to.' },
            'message': { type: 'string', description: 'The message to send.' },
        },
        perform: async function (agent, player_name, message) {
            if (!convoManager.isOtherAgent(player_name))
                return player_name + ' is not a bot, cannot start conversation.';
            if (convoManager.inConversation() && !convoManager.inConversation(player_name)) 
                convoManager.forceEndCurrentConversation();
            else if (convoManager.inConversation(player_name))
                agent.history.add('system', 'You are already in conversation with ' + player_name + '. Don\'t use this command to talk to them.');
            convoManager.startConversation(player_name, message);
        }
    },
    {
        name: '!endConversation',
        description: 'End the conversation with the given bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to end the conversation with.' }
        },
        perform: async function (agent, player_name) {
            if (!convoManager.inConversation(player_name))
                return `Not in conversation with ${player_name}.`;
            convoManager.endConversation(player_name);
            return `Converstaion with ${player_name} ended.`;
        }
    },
    {
        name: '!lookAtPlayer',
        description: 'Look at a player or look in the same direction as the player.',
        params: {
            'player_name': { type: 'string', description: 'Name of the target player' },
            'direction': {
                type: 'string',
                description: 'How to look ("at": look at the player, "with": look in the same direction as the player)',
            }
        },
        perform: async function(agent, player_name, direction) {
            if (direction !== 'at' && direction !== 'with') {
                return "Invalid direction. Use 'at' or 'with'.";
            }
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPlayer(player_name, direction);
            };
            await agent.actions.runAction('action:lookAtPlayer', actionFn);
            return result;
        }
    },
    {
        name: '!lookAtPosition',
        description: 'Look at specified coordinates.',
        params: {
            'x': { type: 'int', description: 'x coordinate' },
            'y': { type: 'int', description: 'y coordinate' },
            'z': { type: 'int', description: 'z coordinate' }
        },
        perform: async function(agent, x, y, z) {
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPosition(x, y, z);
            };
            await agent.actions.runAction('action:lookAtPosition', actionFn);
            return result;
        }
    },
    {
        name: '!digDown',
        description: 'Digs down a specified distance. Will stop if it reaches lava, water, or a fall of >=4 blocks below the bot.',
        params: {'distance': { type: 'int', description: 'Distance to dig down', domain: [1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, distance) => {
            await skills.digDown(agent.bot, distance)
        })
    },
    {
        name: '!goToSurface',
        description: 'Moves the bot to the highest block above it (usually the surface).',
        params: {},
        perform: runAsAction(async (agent) => {
            await skills.goToSurface(agent.bot);
        })
    },
    {
        name: '!useOn',
        description: 'Use (right click) the given tool on the nearest target of the given type.',
        params: {
            'tool_name': { type: 'string', description: 'Name of the tool to use, or "hand" for no tool.' },
            'target': { type: 'string', description: 'The target as an entity type, block type, or "nothing" for no target.' }
        },
        perform: runAsAction(async (agent, tool_name, target) => {
            await skills.useToolOn(agent.bot, tool_name, target);
        })
    },
];
