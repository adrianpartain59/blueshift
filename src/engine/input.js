// engine/input.js — action-mapped input with press buffering. Keyboard, touch zones, gamepad,
// plus inject() so bots and tests drive the exact same path as a player.
//
//   const input = createInput({ jump: ['Space', 'ArrowUp', 'KeyW'], dash: ['ShiftLeft', 'KeyX'] });
//   each sim step:  input.update(dt);  if (input.buffered('jump', 0.12)) { input.consume('jump'); ... }

export function createInput(bindings, target = window) {
  const actions = {};
  const codeToActions = new Map();
  for (const name in bindings) {
    actions[name] = { held: false, sources: 0, pressAge: Infinity, releaseAge: Infinity, pressCount: 0 };
    for (const code of bindings[name]) {
      if (!codeToActions.has(code)) codeToActions.set(code, []);
      codeToActions.get(code).push(name);
    }
  }
  const heldCodes = new Set();
  let anyPress = false;
  let lastDevice = 'keyboard';
  const listeners = [];
  const on = (t, ev, fn, opts) => { t.addEventListener(ev, fn, opts); listeners.push([t, ev, fn, opts]); };

  function press(name) {
    const a = actions[name]; if (!a) return;
    a.sources++;
    if (!a.held) { a.held = true; a.pressAge = 0; a.pressCount++; }
    anyPress = true;
  }
  function release(name) {
    const a = actions[name]; if (!a) return;
    a.sources = Math.max(0, a.sources - 1);
    if (a.sources === 0 && a.held) { a.held = false; a.releaseAge = 0; }
  }

  on(target, 'keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const list = codeToActions.get(e.code);
    if (list) e.preventDefault();
    if (e.repeat || heldCodes.has(e.code)) return;
    heldCodes.add(e.code);
    lastDevice = 'keyboard';
    anyPress = true;
    if (list) for (const n of list) press(n);
  });
  on(target, 'keyup', (e) => {
    if (!heldCodes.has(e.code)) return;
    heldCodes.delete(e.code);
    const list = codeToActions.get(e.code);
    if (list) for (const n of list) release(n);
  });
  on(target, 'blur', () => {
    heldCodes.clear();
    for (const n in actions) { const a = actions[n]; a.sources = 0; if (a.held) { a.held = false; a.releaseAge = 0; } }
  });

  // ---- touch / pointer zones: zoneFn(xNorm, yNorm, pointerEvent) -> action name or null
  let zoneFn = null;
  const pointerAction = new Map();
  function attachPointer(el, fn) {
    zoneFn = fn;
    el.style.touchAction = 'none';
    on(el, 'pointerdown', (e) => {
      const r = el.getBoundingClientRect();
      const name = zoneFn ? zoneFn((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e) : null;
      lastDevice = e.pointerType === 'touch' ? 'touch' : 'pointer';
      anyPress = true;
      if (name) { pointerAction.set(e.pointerId, name); press(name); e.preventDefault(); }
    });
    const up = (e) => { const name = pointerAction.get(e.pointerId); if (name) { pointerAction.delete(e.pointerId); release(name); } };
    on(el, 'pointerup', up); on(el, 'pointercancel', up); on(el, 'pointerleave', up);
    on(el, 'contextmenu', (e) => e.preventDefault());
  }

  // ---- gamepad: buttonMap = { 0: 'jump', 1: 'dash', ... } (standard mapping indices)
  let padMap = null;
  const padHeld = {};
  function pollGamepad() {
    if (!padMap || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    const state = {};
    for (const p of pads) {
      if (!p) continue;
      for (const idx in padMap) { const b = p.buttons[idx]; if (b && (b.pressed || b.value > 0.5)) state[padMap[idx]] = true; }
    }
    for (const idx in padMap) {
      const name = padMap[idx];
      if (state[name] && !padHeld[name]) { padHeld[name] = true; lastDevice = 'gamepad'; press(name); }
      else if (!state[name] && padHeld[name]) { padHeld[name] = false; release(name); }
    }
  }
  function rumble(strong = 0.5, weak = 0.5, ms = 80) {
    if (lastDevice !== 'gamepad' || !navigator.getGamepads) return;
    for (const p of navigator.getGamepads()) {
      if (p && p.vibrationActuator && p.vibrationActuator.playEffect) {
        p.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
      }
    }
  }

  const injected = {};
  return {
    actions,
    get lastDevice() { return lastDevice; },
    // Call once per simulation step.
    update(dt) {
      pollGamepad();
      for (const n in actions) { const a = actions[n]; a.pressAge += dt; a.releaseAge += dt; }
    },
    down: (name) => actions[name].held,
    // True if the action was pressed within the last `window` seconds and not yet consumed.
    buffered: (name, window = 0.1) => actions[name].pressAge <= window,
    released: (name, window = 0.05) => actions[name].releaseAge <= window,
    consume(name) { actions[name].pressAge = Infinity; },
    consumeRelease(name) { actions[name].releaseAge = Infinity; },
    clear() { for (const n in actions) { actions[n].pressAge = Infinity; actions[n].releaseAge = Infinity; } anyPress = false; },
    // True once after any key/tap since the last call (for "press any key").
    takeAnyPress() { const v = anyPress; anyPress = false; return v; },
    // Programmatic input (bots, tests). inject('jump', true) presses, inject('jump', false) releases.
    inject(name, isDown) {
      if (isDown && !injected[name]) { injected[name] = true; press(name); }
      else if (!isDown && injected[name]) { injected[name] = false; release(name); }
    },
    tap(name) { press(name); release(name); },
    attachPointer,
    setGamepadMap(map) { padMap = map; },
    rumble,
    destroy() { for (const [t, ev, fn, opts] of listeners) t.removeEventListener(ev, fn, opts); },
  };
}
