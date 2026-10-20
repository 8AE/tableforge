import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Every run has its own disposable campaign store; never use user data.
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tableforge-e2e-'));
const server = spawn(process.execPath, ['server.js'], { stdio: 'inherit', env: { ...process.env, HOST: '127.0.0.1', PORT: process.env.TABLEFORGE_TEST_PORT || '5184', TABLEFORGE_DATA_DIR: dataDir } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', async (code) => { await fs.rm(dataDir, { recursive: true, force: true }); process.exit(code || 0); });
