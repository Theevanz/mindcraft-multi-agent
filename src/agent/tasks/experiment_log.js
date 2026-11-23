import { mkdirSync, appendFileSync } from 'fs';

// Per-bot JSONL experiment log: bots/<name>/runs/runs.jsonl
// One line per event; runs grouped by run id. Pure addition, never removes anything.
export function logRunEvent(agent, event, data = {}) {
    try {
        const dir = `./bots/${agent.name}/runs`;
        mkdirSync(dir, { recursive: true });
        const runId = agent.task?.taskStartTime || 'notask';
        appendFileSync(`${dir}/runs.jsonl`, JSON.stringify({ t: Date.now(), run: runId, bot: agent.name, event, ...data }) + '\n');
    } catch (e) {
        console.warn('experiment log failed:', e.message);
    }
}

// Ground-truth build status for blueprint tasks. Computed from the world,
// never hallucinated. Used for $MEMORY so small models get facts, not stories.
export function blueprintStatusLine(agent) {
    try {
        const blueprint = agent.task.blueprint;
        const levels = blueprint.data.levels;
        const done = [];
        let current = -1;
        for (let n = 0; n < levels.length; n++) {
            const r = blueprint.checkLevel(agent.bot, n);
            if (r.mismatches.length === 0) done.push(n);
            else if (current < 0) current = n;
        }
        const taskId = agent.task.data?.task_id || 'blueprint';
        if (current < 0)
            return `Build status (${taskId}): all ${levels.length} levels complete.`;
        return `Build status (${taskId}): ${done.length}/${levels.length} levels complete. Working on level ${current}. Keep calling !newAction until every level reports complete.`;
    } catch (e) {
        return agent.history?.memory || '';
    }
}
