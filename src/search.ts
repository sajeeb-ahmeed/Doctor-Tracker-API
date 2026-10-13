/** Lowercase word prefixes allow MongoDB to derive bounds on a multikey index. */
export function searchTokens(...values: unknown[]): string[] {
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .flatMap(
          (value) =>
            value
              .normalize('NFKC')
              .toLowerCase()
              .match(/[\p{L}\p{N}]+/gu) || [],
        ),
    ),
  ];
}

export function indexedSearch(query: string) {
  const tokens = searchTokens(query);
  if (!tokens.length) return { searchTokens: { $in: [] } };
  return {
    $and: tokens.map((token) => ({
      searchTokens: new RegExp('^' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    })),
  };
}
