import { startServer } from './app.ts';
import { paths } from './paths.ts';

const { port } = await startServer(Number(process.env.PORT ?? 4312));
console.log(`WSL-Vpn API on http://localhost:${port} (data: ${paths.dataDir})`);
