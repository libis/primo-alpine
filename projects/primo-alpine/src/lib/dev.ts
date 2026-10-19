/** Recursively freezes plain objects and arrays. Leaves class instances (Dates, Maps, ...) alone. */
export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value as object)) return value;
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return value;
  seen.add(value as object);
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as any)[key], seen);
  }
  return Object.freeze(value);
}

export function warn(message: string, ...extra: unknown[]): void {
  console.warn(`[primo-alpine] ${message}`, ...extra);
}
