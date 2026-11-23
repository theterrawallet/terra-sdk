/** A tiny typed event emitter. Listener errors are isolated so one bad listener never breaks the others. */
export interface Emitter<E extends Record<string, unknown>> {
  on<K extends keyof E>(event: K, cb: (data: E[K]) => void): () => void;
  off<K extends keyof E>(event: K, cb: (data: E[K]) => void): void;
  emit<K extends keyof E>(event: K, data: E[K]): void;
  clear(): void;
}

export function createEmitter<E extends Record<string, unknown>>(): Emitter<E> {
  const map = new Map<keyof E, Set<(d: never) => void>>();
  const off = <K extends keyof E>(event: K, cb: (data: E[K]) => void) => void map.get(event)?.delete(cb);
  return {
    on(event, cb) {
      let set = map.get(event);
      if (!set) map.set(event, (set = new Set()));
      set.add(cb);
      return () => off(event, cb);
    },
    off,
    emit(event, data) {
      for (const cb of [...(map.get(event) ?? [])]) {
        try {
          (cb as (d: typeof data) => void)(data);
        } catch {
          /* a listener threw: keep notifying the others */
        }
      }
    },
    clear: () => map.clear(),
  };
}
