import { useEffect, useRef, useState } from 'react';
import type { WorkerClient } from './workerClient';
import type { WorkerRequest } from '../worker/protocol';

type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

/**
 * Runs one or more worker requests whenever `deps` change; keeps the previous value while a new
 * one loads (stale flag) so charts never flash empty. Out-of-order responses are discarded.
 */
export function useWorkerQuery<T>(client: WorkerClient, build: () => Req[] | null, deps: unknown[]): { data: T | null; stale: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const reqs = build();
    if (!reqs) return;
    const n = ++seq.current;
    setStale(true);
    (async () => {
      const out: unknown[] = [];
      for (const r of reqs) out.push(await client.request(r));
      return out;
    })().then((out) => {
      if (n !== seq.current) return;
      setData((out.length === 1 ? out[0] : out) as T);
      setError(null);
      setStale(false);
    }).catch((e) => {
      if (n !== seq.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setStale(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, stale, error };
}
