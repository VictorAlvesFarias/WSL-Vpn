import { useEffect, useState } from 'react';
import type { LogEntry, PanelState } from './types';

const maxEntries = 500;

/** Live panel state and log pushed by the server (Server-Sent Events, auto-reconnecting). */
export function useServerEvents() {
  const [state, setState] = useState<PanelState | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener('state', (event) => setState(JSON.parse((event as MessageEvent).data)));
    // Sent on every (re)connection, so it replaces whatever was there.
    source.addEventListener('history', (event) => setLog(JSON.parse((event as MessageEvent).data)));
    source.addEventListener('log', (event) => {
      const entry = JSON.parse((event as MessageEvent).data) as LogEntry;
      setLog((current) => [...current.slice(-(maxEntries - 1)), entry]);
    });
    return () => source.close();
  }, []);

  return { state, log, connected };
}
