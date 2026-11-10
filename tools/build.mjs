#!/usr/bin/env node
// tools/build.mjs — zero-dependency bundler. Turns the ES-module source tree into ONE classic
// <script> inlined into a single HTML file that runs from file://, any static host, or as a
// claude.ai artifact.
//
//   node tools/build.mjs            -> dist/index.html (standalone page) + dist/artifact.html (fragment)
//   node tools/build.mjs --check src/game/city.js   -> validate one module against the dialect below
//
// It is deliberately tiny, so the source follows a strict module dialect (enforced here):
//   - imports/exports are top-level statements starting in column 0
//   - `import { a, b as c } from './x.js'` and `import * as ns from './x.js'` only (no default imports)
//   - `export function|class|const NAME`, or `export { a, b as c };` (no default, no `export let`, no re-exports)
//   - relative specifiers ending in .js, no circular imports, no top-level await, no import.meta
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'src/main.js';

const IMPORT_RE = /^import\s+([^'"]*?)\s+from\s+['"]([^'"]+)['"]\s*;?[ \t]*$/gm;
const BARE_IMPORT_RE = /^import\s+['"]([^'"]+)['"]\s*;?[ \t]*$/gm;
const EXPORT_DECL_RE = /^export\s+(async\s+function\*?|function\*?|class|const)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_RE = /^export\s*\{([^}]*)\}\s*;?[ \t]*$/gm;

function fail(file, msg) { throw new Error(`[build] ${file}: ${msg}`); }

function parseModule(id) {
  const file = path.join(ROOT, id);
  let src = fs.readFileSync(file, 'utf8');
  const deps = [];
  const wants = [];             // [dep id, imported name] pairs, checked against the dep's exports after the walk
  const exportsMap = new Map(); // exported name -> local name

  if (/^export\s+default\b/m.test(src)) fail(id, 'default exports are not supported');
  if (/^export\s+(let|var)\b/m.test(src)) fail(id, '`export let/var` is not supported (export a const object instead)');
  if (/^export\s+const\s*[{[]/m.test(src)) fail(id, 'destructuring exports are not supported');
  if (/^export\s*\{[^}]*\}\s*from\b/m.test(src)) fail(id, 're-exports are not supported');
  if (/^export\s*\*/m.test(src)) fail(id, '`export *` is not supported');
  if (/\bimport\.meta\b/.test(src)) fail(id, 'import.meta is not supported');
  if (/\bimport\s*\(/.test(src)) fail(id, 'dynamic import() is not supported');

  const resolve = (spec) => {
    if (!spec.startsWith('.')) fail(id, `only relative imports are supported: '${spec}'`);
    const dep = path.posix.normalize(path.posix.join(path.posix.dirname(id), spec));
    if (!fs.existsSync(path.join(ROOT, dep))) fail(id, `import not found: '${spec}'`);
    if (!deps.includes(dep)) deps.push(dep);
    return dep;
  };

  src = src.replace(IMPORT_RE, (m, clause, spec) => {
    const dep = resolve(spec);
    clause = clause.trim();
    const ns = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (ns) return `const ${ns[1]} = __req(${JSON.stringify(dep)});`;
    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (!named) fail(id, `unsupported import clause: import ${clause} from '${spec}'`);
    const parts = named[1].split(',').map((s) => s.trim()).filter(Boolean).map((p) => {
      const mm = p.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!mm) fail(id, `unsupported import specifier '${p}'`);
      wants.push([dep, mm[1]]);
      return mm[2] ? `${mm[1]}: ${mm[2]}` : mm[1];
    });
    return `const { ${parts.join(', ')} } = __req(${JSON.stringify(dep)});`;
  });
  src = src.replace(BARE_IMPORT_RE, (m, spec) => `__req(${JSON.stringify(resolve(spec))});`);
  if (/^import\s/m.test(src)) {
    const line = src.split('\n').find((l) => /^import\s/.test(l));
    fail(id, `could not parse import statement: ${line}`);
  }

  // `export const A = 1, B = 2;` would silently export only A (the regex below sees one name per
  // statement), leaving B undefined in the bundle while the dev build works. Refuse it.
  for (const line of src.split('\n')) {
    if (!/^export\s+const\s/.test(line)) continue;
    let depth = 0, quote = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '/' && line[i + 1] === '/') break;
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 0 && /^\s*[A-Za-z_$][\w$]*\s*=[^=>]/.test(line.slice(i + 1))) fail(id, `one name per export statement, please: ${line.trim().slice(0, 80)}`);
    }
  }
  src = src.replace(EXPORT_DECL_RE, (m, kind, name) => { exportsMap.set(name, name); return `${kind} ${name}`; });
  src = src.replace(EXPORT_LIST_RE, (m, list) => {
    for (const p of list.split(',').map((s) => s.trim()).filter(Boolean)) {
      const mm = p.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!mm) fail(id, `unsupported export specifier '${p}'`);
      exportsMap.set(mm[2] || mm[1], mm[1]);
    }
    return '';
  });
  if (/^export\s/m.test(src)) {
    const line = src.split('\n').find((l) => /^export\s/.test(l));
    fail(id, `could not parse export statement: ${line}`);
  }
  return { id, src, deps, exportsMap, wants };
}

export function bundle(entry = ENTRY) {
  const mods = new Map();
  const order = [];
  const visiting = new Set();
  const visit = (id, chain) => {
    if (mods.has(id) && !visiting.has(id)) return;
    if (visiting.has(id)) throw new Error(`[build] circular import: ${[...chain, id].join(' -> ')}`);
    visiting.add(id);
    const m = parseModule(id);
    mods.set(id, m);
    for (const d of m.deps) visit(d, [...chain, id]);
    visiting.delete(id);
    order.push(m);
  };
  visit(entry, []);
  // every imported name must really be exported: in the bundle a missing one is a silent `undefined`
  for (const m of order) for (const [dep, name] of m.wants) {
    if (!mods.get(dep).exportsMap.has(name)) throw new Error(`[build] ${m.id} imports '${name}', which ${dep} does not export`);
  }
  let out = '(function () {\n"use strict";\nvar __m = Object.create(null);\n' +
    'function __req(id) { var m = __m[id]; if (!m) throw new Error("module not loaded: " + id); return m; }\n';
  for (const m of order) {
    const ex = [...m.exportsMap].map(([name, local]) => `${name}: ${local}`).join(', ');
    out += `\n// ---- ${m.id}\n__m[${JSON.stringify(m.id)}] = (function () {\n${m.src}\nreturn { ${ex} };\n})();\n`;
  }
  out += '\n})();\n';
  return { code: out, modules: order.map((m) => m.id) };
}

function main() {
  // `--check src/game/x.js`: validate one module (and its imports) against the dialect, without writing dist/.
  const ci = process.argv.indexOf('--check');
  if (ci > 0) {
    const entry = path.posix.normalize(process.argv[ci + 1] || ENTRY);
    const r = bundle(entry);
    new Function(r.code); // parse only: throws on a syntax error introduced by bundling
    console.log(`dialect ok: ${entry} (+${r.modules.length - 1} imports)`);
    return;
  }
  const { code, modules } = bundle();
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  const bundlePath = path.join(ROOT, 'dist', 'bundle.js');
  fs.writeFileSync(bundlePath, code);

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scriptTag = /<script type="module" src="\.\/src\/main\.js"><\/script>/;
  if (!scriptTag.test(html)) throw new Error('[build] index.html must contain <script type="module" src="./src/main.js"></script>');
  const inline = '<script>\n' + code.replace(/<\/script/gi, '<\\/script') + '</script>';
  const standalone = html.replace(scriptTag, () => inline);
  fs.writeFileSync(path.join(ROOT, 'dist', 'index.html'), standalone);

  // Artifact fragment: everything between the HEAD and BODY markers, without the document skeleton.
  const head = html.match(/<!--HEAD-START-->([\s\S]*?)<!--HEAD-END-->/);
  const body = html.match(/<!--BODY-START-->([\s\S]*?)<!--BODY-END-->/);
  if (head && body) {
    const frag = head[1].trim() + '\n' + body[1].replace(scriptTag, () => inline).trim() + '\n';
    fs.writeFileSync(path.join(ROOT, 'dist', 'artifact.html'), frag);
  }
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  console.log(`bundled ${modules.length} modules -> dist/index.html (${kb(standalone.length)})` + (head && body ? ' + dist/artifact.html' : ''));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
