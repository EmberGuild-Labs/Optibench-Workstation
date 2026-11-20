/** Id helpers for paste / duplicate. */
export function makeIdFactory(existing: Iterable<string>): (prefix: string) => string {
  const used = new Set(existing);
  return (prefix: string) => {
    let id = '';
    do {
      id = `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
    } while (used.has(id));
    used.add(id);
    return id;
  };
}

/** Next free reference designator: R1 -> R3 if R1,R2 exist. */
export function nextDesignator(name: string | undefined, existing: Iterable<string | undefined>): string | undefined {
  if (!name) return name;
  const m = /^(.*?)(\d+)$/.exec(name);
  if (!m) return name;
  const taken = new Set<string>();
  for (const n of existing) if (n) taken.add(n);
  let k = 1;
  while (taken.has(`${m[1]}${k}`)) k++;
  return `${m[1]}${k}`;
}
