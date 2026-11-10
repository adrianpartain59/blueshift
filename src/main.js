// main.js — boot. Creates the renderer and the game; shows a plain message if WebGL2 is missing.
import { createGfx } from './engine/gfx.js';
import { createGame } from './game/game.js';

function boot() {
  const canvas = document.getElementById('game');
  const gfx = createGfx(canvas);
  if (!gfx) {
    const fb = document.getElementById('fallback');
    if (fb) fb.hidden = false;
    canvas.hidden = true;
    return;
  }
  // A lost GPU context (driver reset, tab discarded) cannot be repaired in place: reload when it comes back.
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => location.reload());
  const game = createGame({ canvas, gfx, params: new URLSearchParams(location.search) });
  // hooks for tools/shots.mjs and debugging: window.__stage.seek(seconds)
  window.__stage = game;
  game.start();
  canvas.focus({ preventScroll: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
