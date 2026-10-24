import { randomUUID } from 'node:crypto';
import type { Store } from './store.ts';

export class RemoteError extends Error {
  status: number; constructor(status: number, message: string) { super(message); this.status = status; }
}
export class Remote {
  store: Store;
  constructor(store: Store) { this.store = store; }
  async call(path: string, method = 'GET', body?: any) {
    const base = new URL(this.store.state.server);
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname))) throw new Error('Remote server must use HTTPS; HTTP is allowed only on loopback');
    const response = await fetch(new URL(path,base), {method, headers: {
      ...(this.store.state.token ? {Authorization:`Bearer ${this.store.state.token}`} : {}),
      ...(body ? {'Content-Type':'application/json'} : {})
    }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000), redirect: 'error'});
    const result = await response.json() as any;
    if (!response.ok) throw new RemoteError(response.status,result.error?.message || `Server returned ${response.status}`);
    return result;
  }
  async mutate(path: string, body: any = {}, method = 'POST') {
    return this.call(path,method,{...body,idempotency_key:body.idempotency_key || randomUUID()});
  }
  async durable(path: string, body: any, method = 'POST') {
    const item = {id:randomUUID(),path,method,body:{...body,idempotency_key:body.idempotency_key || randomUUID()}};
    this.store.state.outbox.push(item); this.store.save();
    try {
      const result = await this.call(path,method,item.body);
      this.store.state.outbox = this.store.state.outbox.filter(i=>i.id!==item.id); this.store.save();
      return result;
    } catch (error) {
      if (error instanceof RemoteError && error.status < 500 && ![408,429].includes(error.status)) {
        this.store.state.outbox = this.store.state.outbox.filter(i=>i.id!==item.id); this.store.save(); throw error;
      }
      return {pending:true,operation_id:item.id,message:'Saved locally; delivery will retry with the same idempotency key.'};
    }
  }
  async flush() {
    for (const item of [...this.store.state.outbox]) {
      try { await this.call(item.path,item.method,item.body); }
      catch (error) {
        if (!(error instanceof RemoteError) || error.status >= 500 || [408,429].includes(error.status)) throw error;
        this.store.state.connection_error = `Queued operation rejected: ${error.message}`;
      }
      this.store.state.outbox = this.store.state.outbox.filter(i=>i.id!==item.id); this.store.save();
    }
  }
}
