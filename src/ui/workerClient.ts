import type { WorkerRequest, WorkerResponse } from '../worker/protocol';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

/** Promise wrapper around the single data worker. */
export class WorkerClient {
  private worker = new Worker(new URL('../worker/worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, Pending>();
  onProgress: ((done: number, total: number, label: string) => void) | null = null;

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const m = ev.data;
      if (m.type === 'progress') {
        this.onProgress?.(m.done, m.total, m.label);
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.type === 'result') p.resolve(m.value);
      else p.reject(new Error(m.message));
    };
  }

  request<T>(req: Req): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...req, id } as WorkerRequest);
    });
  }
}
