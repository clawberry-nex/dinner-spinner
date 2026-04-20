// moveItem returns a new array with the element at `from` moved to
// index `to`. Indices must be integers within [0, arr.length); invalid
// inputs return a shallow copy of the original array unchanged. The
// result is always a new array reference, never the input.
export function moveItem<T>(
  arr: readonly T[],
  from: number,
  to: number,
): T[] {
  const copy = [...arr];
  if (!Number.isInteger(from) || !Number.isInteger(to)) return copy;
  if (from < 0 || from >= copy.length) return copy;
  if (to < 0 || to >= copy.length) return copy;
  if (from === to) return copy;
  const [removed] = copy.splice(from, 1);
  copy.splice(to, 0, removed);
  return copy;
}
