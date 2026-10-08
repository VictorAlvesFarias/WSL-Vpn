import { exec } from './exec.ts';

/** Comment that marks the NRPT (DNS) rules created by gateway.ps1. */
export const gatewayTag = 'vpnwsl-gateway';

function ipToNumber(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inNetwork(ip: string, cidr: string): boolean {
  const [base, bitsText] = cidr.split('/');
  const address = ipToNumber(ip);
  const network = ipToNumber(base);
  const bits = Number(bitsText);
  if (address === null || network === null || !Number.isInteger(bits)) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (address & mask) === (network & mask);
}

/** Windows routes that use the WSL2 VM (eth0 network, e.g. "172.28.128.5/20") as next hop. */
export async function wslGatewayRoutes(eth0Cidr: string): Promise<Array<[string, string]>> {
  if (!eth0Cidr.includes('/')) return [];
  const result = await exec('route', ['print', '-4'], { timeoutMs: 10_000 });
  const routes: Array<[string, string]> = [];
  // Active route lines: destination, mask, gateway, interface, metric. The headers are
  // localized but the numbers aren't, so only the column shape is used.
  for (const line of result.stdout.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length === 5 && inNetwork(columns[2], eth0Cidr)) routes.push([columns[0], columns[1]]);
  }
  return routes;
}

/** True when an NRPT rule created by gateway.ps1 exists. */
export async function hasTaggedNrptRule(): Promise<boolean> {
  const result = await exec(
    'reg',
    ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Dnscache\\Parameters\\DnsPolicyConfig', '/s', '/v', 'Comment'],
    { timeoutMs: 10_000 },
  );
  return result.code === 0 && result.stdout.includes(gatewayTag);
}
