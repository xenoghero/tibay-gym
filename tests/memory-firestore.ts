/** Test-only Firestore subset: no SDK initialization, credentials, or network. */
type Data = Record<string, unknown>;
interface Ref { path: string; id: string; filters?: Array<{ field: string; op: string; value: unknown }>; orders?: Array<{ field: string; direction: string }>; after?: string; cap?: number; query?: boolean }
export function memoryFirestore() {
  const data = new Map<string, Data>();
  const operations: Array<{ kind: string; path: string }> = [];
  let sequence = 0;
  let tail = Promise.resolve();
  const record = (kind: string, path: string) => operations.push({ kind, path });
  const doc = (path: string) => ({ path, id: path.split("/").at(-1)!, get: async () => {
    record("read", path); return snapshot(path);
  }, set: async (value: Data) => { record("set", path); data.set(path, value); },
    update: async (value: Data) => { if (!data.has(path)) throw new Error("Missing document"); record("update", path); data.set(path, { ...data.get(path), ...value }); },
    delete: async () => { record("delete", path); data.delete(path); },
  });
  const snapshot = (path: string) => ({ id: path.split("/").at(-1)!, ref: doc(path), exists: data.has(path), data: () => data.get(path) });
  const rows = (ref: Ref) => {
    let entries = [...data].filter(([path, value]) => path.startsWith(`${ref.path}/`) &&
      path.split("/").length === ref.path.split("/").length + 1 &&
      (ref.filters ?? []).every(({ field, value: expected, op }) => {
        const actual = value[field];
        if (actual == null && expected != null) return false;
        return op === "==" ? actual === expected : op === "<=" ? actual! <= expected! : actual! >= expected!;
      }));
    if (ref.orders?.length) entries.sort(([ap, av], [bp, bv]) => {
      for (const { field, direction } of ref.orders!) {
        const a = field === "__name__" ? ap : av[field], b = field === "__name__" ? bp : bv[field];
        const comparison = a! < b! ? -1 : a! > b! ? 1 : 0;
        if (comparison) return direction === "desc" ? -comparison : comparison;
      }
      return 0;
    });
    if (ref.after) entries = entries.slice(entries.findIndex(([path]) => path === ref.after) + 1);
    const docs = entries.slice(0, ref.cap ?? Infinity).map(([path]) => snapshot(path));
    return { docs, empty: !docs.length, size: docs.length };
  };
  const collection = (path: string, options: Partial<Ref> = {}) => ({
    path, id: path, ...options, query: true,
    doc: () => doc(`${path}/test-log-${++sequence}`),
    where: (key: string, op: string, expected: unknown) => {
      if (!["==", "<=", ">="].includes(op)) throw new Error("Unsupported test query");
      return collection(path, { ...options, filters: [...options.filters ?? [], { field: key, op, value: expected }] });
    },
    orderBy: (field: string, direction = "asc") => collection(path, { ...options, orders: [...options.orders ?? [], { field, direction }] }),
    startAfter: (row: { ref: Ref } | string) => collection(path, { ...options, after: typeof row === "string" ? `${path}/${row}` : row.ref.path }),
    limit: (limit: number) => collection(path, { ...options, cap: limit }),
    get: async () => { record("query", path); return rows({ path, id: path, ...options }); },
  });
  const db = {
    doc, collection,
    batch: () => {
      const refs: Ref[] = [];
      return { delete: (ref: Ref) => { refs.push(ref); }, commit: async () => {
        for (const ref of refs) { record("delete", ref.path); data.delete(ref.path); }
      } };
    },
    runTransaction: <T>(callback: (tx: {
      get(ref: Ref): Promise<{ data(): Data | undefined } | ReturnType<typeof rows>>;
      getAll(...refs: Ref[]): Promise<ReturnType<typeof snapshot>[]>;
      set(ref: Ref, value: Data): void;
      update(ref: Ref, value: Data): void;
      delete(ref: Ref): void;
    }) => Promise<T>): Promise<T> => {
      const run = tail.then(async () => {
        record("transaction", "");
        let writing = false;
        const writes: Array<() => void> = [];
        const tx = {
          get: async (ref: Ref) => {
            if (writing) throw new Error("Test transaction read after write");
            record(ref.query ? "query" : "read", ref.path);
            return ref.query ? rows(ref) : snapshot(ref.path);
          },
          getAll: async (...refs: Ref[]) => {
            if (writing) throw new Error("Test transaction read after write");
            return refs.map(ref => { record("read", ref.path); return snapshot(ref.path); });
          },
          set: (ref: Ref, value: Data) => {
            writing = true; writes.push(() => { record("set", ref.path); data.set(ref.path, value); });
          },
          update: (ref: Ref, value: Data) => {
            writing = true; writes.push(() => {
              if (!data.has(ref.path)) throw new Error("Test update requires a document");
              const previous = data.get(ref.path)!;
              const next = { ...previous, ...value };
              // The attendance service's only increment is visitCount + 1.
              if (typeof value.visitCount === "object" && value.visitCount !== null) next.visitCount = Number(previous.visitCount) + 1;
              record("update", ref.path); data.set(ref.path, next);
            });
          },
          delete: (ref: Ref) => { writing = true; writes.push(() => { record("delete", ref.path); data.delete(ref.path); }); },
        };
        const result = await callback(tx);
        writes.forEach(write => write());
        return result;
      });
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return { db, data, operations };
}
