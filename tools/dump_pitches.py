#!/usr/bin/env python3
# Dumps concept-panel results from a workflow journal into docs/pitches/*.md and prints a digest.
import json, sys, os, re
journal, outdir = sys.argv[1], sys.argv[2]
mode = sys.argv[3] if len(sys.argv) > 3 else 'digest'
only = sys.argv[4] if len(sys.argv) > 4 else None
started = {}
results = []
for line in open(journal):
    try: j = json.loads(line)
    except Exception: continue
    if j.get('type') == 'started': started[j.get('agentId')] = j.get('label')
    if j.get('type') == 'result': results.append(j)
def md(p):
    out = [f"# {p.get('title')}  ({p.get('_label')})", '', f"**Hook:** {p.get('hook')}", '', f"**Fantasy:** {p.get('fantasy')}", '', f"**Perspective:** {p.get('perspective')}", '', f"**Core loop:** {p.get('coreLoop')}", '', '## Controls']
    for c in p.get('controls', []): out.append(f"- **{c['input']}** → {c['action']}  \n  _Feedback:_ {c['feedback']}")
    out.append('\n## Mechanics')
    for m in p.get('mechanics', []): out.append(f"### {m['name']}\n- Rules: {m['rules']}\n- Why fun: {m['whyFun']}\n- Interplay: {m['interplay']}")
    out.append('\n## First 30 seconds')
    for b in p.get('first30Seconds', []): out.append(f"- {b}")
    for k, title in [('signatureMoment','Signature moment'),('hazardsAndPatterns','Hazards and patterns'),('readability','Readability'),('riskReward','Risk / reward'),('escalation','Escalation'),('visualDirection','Visual direction'),('audioDirection','Audio direction'),('failureAndRestart','Failure and restart'),('botStrategy','Bot strategy'),('techNotes','Tech notes'),('biggestRisk','Biggest risk'),('whyThisWins','Why this wins')]:
        out.append(f"\n## {title}\n{p.get(k)}")
    out.append('\n## Juice')
    for jz in p.get('juice', []): out.append(f"- {jz}")
    return '\n'.join(out) + '\n'
n = 0
for r in results:
    res = r.get('result')
    label = started.get(r.get('agentId'), '?')
    if not isinstance(res, dict): continue
    res['_label'] = label
    if label.startswith('pitch:'):
        n += 1
        slug = re.sub(r'[^a-z0-9]+', '-', (res.get('title') or 'x').lower()).strip('-')
        path = os.path.join(outdir, f"{label.split(':')[1]}-{slug}.md")
        open(path, 'w').write(md(res))
        if only and only not in label: continue
        if mode == 'digest':
            print(f"\n=================== [{label}] {res.get('title')} ===================")
            print('HOOK:', res.get('hook'))
            print('PERSPECTIVE:', res.get('perspective'))
            print('CORE LOOP:', res.get('coreLoop'))
            print('CONTROLS:')
            for c in res.get('controls', []): print(f"  - {c['input']} → {c['action']}")
            print('MECHANICS:')
            for m in res.get('mechanics', []): print(f"  * {m['name']}: {m['rules']}\n      interplay: {m['interplay']}")
            print('FIRST 30s:')
            for b in res.get('first30Seconds', []): print('  ', b)
            print('SIGNATURE:', res.get('signatureMoment'))
            print('RISK/REWARD:', res.get('riskReward'))
            print('BIGGEST RISK:', res.get('biggestRisk'))
        elif mode == 'full':
            print(md(res))
    elif label.startswith('judge:'):
        path = os.path.join(outdir, f"_verdict-{label.split(':')[1]}.json")
        json.dump(res, open(path, 'w'), indent=1)
        if mode == 'verdicts':
            print(f"\n=================== [{label}] winner: {res.get('winner')} ===================")
            print('RANKING:', ' > '.join(res.get('ranking', [])))
            for s in res.get('scores', []):
                tot = sum(s.get(k, 0) for k in ['coreVerbFun','first30s','depth','readability','spectacle','feasibility','oneMoreRun'])
                print(f"  {s['title']}: verb {s['coreVerbFun']} first30 {s['first30s']} depth {s['depth']} read {s['readability']} spect {s['spectacle']} feas {s['feasibility']} again {s['oneMoreRun']} = {tot}")
                print(f"      play: {s['playthrough']}\n      flaw: {s['fatalFlaw']}")
            print('RATIONALE:', res.get('winnerRationale'))
            print('GRAFTS:')
            for g in res.get('grafts', []): print(f"  - from {g['from']}: {g['idea']} — {g['why']}")
            print('CUTS:', res.get('cutsForWinner'))
            print('DISSENT:', res.get('dissent'))
print(f"\n[{n} pitches dumped to {outdir}]", file=sys.stderr)
