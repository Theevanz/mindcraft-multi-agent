#!/usr/bin/env python3
"""Score blueprint runs from bots/*/runs/runs.jsonl. Usage: python3 /tmp/analyze_runs.py [bot ...]"""
import json, glob, sys
from collections import Counter, defaultdict
from datetime import datetime

want = set(sys.argv[1:]) or None
runs = defaultdict(list)
for f in glob.glob('bots/*/runs/runs.jsonl'):
    for line in open(f):
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except Exception:
            continue
        if want and e.get('bot') not in want:
            continue
        runs[(e.get('bot'), e.get('run'))].append(e)

if not runs:
    print('No experiment logs yet. Run the bots first.')
    raise SystemExit

def ts(ms):
    return datetime.fromtimestamp(ms / 1000).strftime('%m-%d %H:%M')

for (bot, run), evs in sorted(runs.items(), key=lambda kv: kv[1][0]['t']):
    evs.sort(key=lambda e: e['t'])
    start, end = evs[0]['t'], evs[-1]['t']
    passes = [e for e in evs if e['event'] == 'build_pass']
    placed = sum(e.get('placed', 0) for e in passes)
    failed = sum(e.get('failed', 0) for e in passes)
    occ = sum(e.get('occupied', 0) for e in passes)
    done_levels = sorted({e['level'] for e in passes if e.get('remaining') == 0})
    maxlvl = max(done_levels) + 1 if done_levels else 0
    fails = Counter()
    for e in passes:
        for x in e.get('failures', []) or []:
            fails[str(x)[:90]] += 1
    redir = sum(1 for e in evs if e['event'] == 'redirect')
    esc = sum(1 for e in evs if e['event'] == 'escalation')
    regs = [e for e in evs if e['event'] == 'regression']
    mems = [e for e in evs if e['event'] == 'memory_snapshot']
    start_ev = next((e for e in evs if e['event'] == 'run_start'), {})
    print(f"=== {bot} run {str(run)[-6:]} | {start_ev.get('task_id')} | {ts(start)} -> {ts(end)} ({(end-start)//60000}m) ===")
    waits = sum(1 for e in evs if e['event'] == 'waiting')
    print(f"  passes={len(passes)} placed={placed} failed={failed} occupied={occ} levels_done={len(done_levels)} highest_streak_start={maxlvl} redirects={redir} escalations={esc} regressions={len(regs)} waiting={waits} mem_snaps={len(mems)}")
    for r in regs[:4]:
        print(f"  REGRESS L{r.get('level')}: {r.get('coords')}")
    if fails:
        print('  top failures:')
        for f, n in fails.most_common(4):
            print(f'    x{n} {f}')
    if mems:
        m = mems[-1]
        print(f"  model memory: {(m.get('model_says') or '')[:160]}")
        print(f"  truth:        {(m.get('truth') or '')[:160]}")
    print()
