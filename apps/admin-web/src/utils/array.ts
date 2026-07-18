/**
 * Shared functional helpers used by the merchant admin SPA.
 *
 * The admin app deliberately mirrors the h5-store's `utils/array.ts` so
 * both SPAs speak the same vocabulary (`groupBy`, `sortBy`, `sumBy`,
 * `partition`) and so reducers scattered through views are easy to spot
 * during code review.
 */

export const groupBy = <T, K extends string>(
  xs: readonly T[],
  key: (x: T) => K,
): Record<K, T[]> =>
  xs.reduce(
    (acc, item) => ({ ...acc, [key(item)]: [...(acc[key(item)] ?? []), item] }),
    {} as Record<K, T[]>,
  );

export const sortBy = <T>(
  xs: readonly T[],
  key: (x: T) => number | string,
  dir: 'asc' | 'desc' = 'asc',
): T[] =>
  [...xs].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === kb) return 0;
    return (ka > kb ? 1 : -1) * (dir === 'asc' ? 1 : -1);
  });

export const sumBy = <T>(xs: readonly T[], key: (x: T) => number): number =>
  xs.reduce((total, item) => total + key(item), 0);

export const partition = <T>(
  xs: readonly T[],
  predicate: (x: T) => boolean,
): { readonly satisfied: T[]; readonly rest: T[] } => {
  const satisfied: T[] = [];
  const rest: T[] = [];
  for (const item of xs) {
    if (predicate(item)) satisfied.push(item);
    else rest.push(item);
  }
  return { satisfied, rest };
};

export const findById = <T extends { id: string }>(
  xs: readonly T[],
  id: string,
): T | undefined => xs.find((item) => item.id === id);
