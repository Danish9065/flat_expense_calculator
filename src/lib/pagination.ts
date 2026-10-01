/** Read every page; never mistake an API row limit or failed page for a full ledger. */
export async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
    count: number | null;
  }>,
) {
  const rows: T[] = [];
  let expectedCount: number | null = null;
  for (;;) {
    const { data, error, count } = await fetchPage(rows.length, rows.length + 199);
    if (error) throw new Error(error.message);
    if (count === null || (expectedCount !== null && count !== expectedCount)) {
      throw new Error('The ledger changed while loading. Please refresh.');
    }
    expectedCount = count;
    rows.push(...(data ?? []));
    if (rows.length === count) return rows;
    if (!data?.length || rows.length > count) throw new Error('Incomplete ledger. Please refresh.');
  }
}
