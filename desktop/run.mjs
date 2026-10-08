// Starts the desktop app. Editors built on Electron (VS Code) export ELECTRON_RUN_AS_NODE=1 to their
// terminals, which would make Electron behave as plain Node, so drop it before launching.
import { spawn } from 'node:child_process';
import electron from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('close', (code) => process.exit(code ?? 0));
