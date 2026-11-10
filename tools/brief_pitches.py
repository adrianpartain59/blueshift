#!/usr/bin/env python3
import json, sys
journal = sys.argv[1]
skip = set(sys.argv[2].split(',')) if len(sys.argv) > 2 else set()
started = {}
def cut(s, n): 
    s = ' '.join(str(s).split())
    return s if len(s) <= n else s[:n] + '…'
for line in open(journal):
    try: j = json.loads(line)
    except Exception: continue
    if j.get('type') == 'started': started[j.get('agentId')] = j.get('label')
    if j.get('type') == 'result':
        label = started.get(j.get('agentId'), '?'); r = j.get('result')
        if not isinstance(r, dict) or not label.startswith('pitch:') or label in skip: continue
        print(f"\n===== [{label}] {r.get('title')} =====")
        print('HOOK:', cut(r.get('hook'), 400))
        print('VIEW:', cut(r.get('perspective'), 350))
        print('LOOP:', cut(r.get('coreLoop'), 600))
        print('CONTROLS:', ' | '.join(f"{c['input']} → {cut(c['action'], 160)}" for c in r.get('controls', [])))
        for m in r.get('mechanics', []): print(f"  * {m['name']}: {cut(m['rules'], 520)}")
        print('SIGNATURE:', cut(r.get('signatureMoment'), 450))
        print('RISK:', cut(r.get('biggestRisk'), 350))
