#!/usr/bin/env node
// tools/serve.mjs — static dev server for the project root (no caching). Usage: node tools/serve.mjs [port]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = +(process.argv[2] || process.env.PORT || 8790);
const { port: actual } = await startServer(root, port);
console.log(`serving ${root} at http://127.0.0.1:${actual}/`);
