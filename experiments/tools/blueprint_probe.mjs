import { getCommand } from '/Users/reeve/Desktop/muse/mindcraft/src/agent/commands/index.js';
import { parkAwayFromSite } from '/Users/reeve/Desktop/muse/mindcraft/src/agent/commands/actions.js';

const run = { runAction: async (l, fn) => { await fn(); return { interrupted: false, message: '' }; } };
const near = { x: 0, y: 0, z: 0, distanceTo: () => 0 };
const blocker = { id: 2, type: 'player', username: 'andy2', position: near };
const fakeBp = {
    data: { levels: [{ level: 0, coordinates: [0, 0, 0], placement: [['stone_bricks']] }] },
    checkLevel: () => ({ mismatches: [{ expected: 'stone_bricks', actual: 'air', coordinates: [0, 0, 0] }] })
};
const agent = {
    name: '_probe', count_id: 0,
    task: { task_type: 'construction', data: { agent_count: 1 }, blueprint: fakeBp, blocked_actions: [] },
    bot: { output: '', game: { gameMode: 'survival' }, entity: { id: 1, position: { x: 9, y: 9, z: 9 } }, entities: { 2: blocker } },
    actions: run
};
const msgs = [];
for (let i = 0; i < 4; i++) msgs.push(await getCommand('!newAction').perform(agent, 'x'));
console.log('OCC_NEVER_STUCK:', msgs.every(m => m.includes('skipped: andy2')) && !msgs.join().includes('3+ times'));

// parking goes outside the footprint via flight
let flewTo = null;
const agentP = {
    task: { blueprint: { data: { levels: [{ coordinates: [100, 60, 50], placement: [['x']] }] } } },
    bot: { game: { gameMode: 'creative' }, creative: { startFlying: async () => {}, flyTo: async (v) => { flewTo = [v.x, v.y, v.z]; } } }
};
await parkAwayFromSite(agentP);
console.log('PARK_OUTSIDE:', JSON.stringify(flewTo) === JSON.stringify([96, 60, 50]));
