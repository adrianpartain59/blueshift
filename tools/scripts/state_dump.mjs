// Prints a JSON fingerprint of a deterministic bot run at a few song times (used by tools/dist_check.mjs).
export default async function (h) {
  await h.waitFor('window.__stage && window.__stage.seek', 20000);
  const out = [];
  for (const t of [3, 9.6, 20, 45, 70]) {
    await h.eval('window.__stage.seek(' + t + ')');
    out.push(await h.eval(`(() => { const g = window.__stage, s = g.sim, f = g.frame; const r = { t, lane: s.lane, gear: s.gear, sector: s.sector, alive: s.alive, lead: +s.lead.toFixed(3), score: Math.floor(s.score), flux: +s.flux.toFixed(2), dist: +s.dist.toFixed(2), hazards: s.hazards.length, walls: s.stats.walls, crashes: s.stats.crashes, quads: g.gfx.stats.quads, danger: +f.danger.toFixed(4), fluxN: +f.fluxN.toFixed(4), leadN: +f.leadN.toFixed(4) }; r.finite = Object.values(r).every((v) => typeof v !== 'number' || Number.isFinite(v)); return r; })()`.replace('t,', 't: ' + t + ',')));
  }
  console.log('STATE ' + JSON.stringify(out));
}
