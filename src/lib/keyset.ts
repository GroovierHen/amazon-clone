import { and, asc, desc, sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * One page of a list, keyset paginated (SPEC.md 6.1). The cursor is the sort
 * value and id of the row at the edge of the page, and the next page is "rows
 * strictly beyond that pair". OFFSET is never used.
 */

export const PAGE_SIZE = 24;

/** Postgres type a cursor's sort value is cast back to. */
export type KeysetCast = "integer" | "numeric" | "float4" | "timestamptz";

/** Shape a cursor's sort value must have before it is sent to Postgres. */
const VALUE_SHAPES: Record<KeysetCast, RegExp> = {
  integer: /^\d+$/,
  numeric: /^\d+(\.\d+)?$/,
  float4: /^-?\d+(\.\d+)?(e-?\d+)?$/,
  timestamptz: /^[\d\-:.+ ]+$/,
};

export type KeysetSort = {
  /** Written into the cursor, so a cursor from one sort is not read as another. */
  key: string;
  value: SQLWrapper;
  /** Breaks ties, in the same direction as the sort. */
  id: SQLWrapper;
  cast: KeysetCast;
  direction: "ASC" | "DESC";
};

export type KeysetOptions = {
  sort: KeysetSort;
  after?: string;
  before?: string;
  /** At most PAGE_SIZE. */
  limit?: number;
  /** The caller's own conditions. The module adds the cursor's. */
  filters?: SQL;
};

/** What the caller's query must apply, all of it, and the column it must select. */
export type KeysetQuery = {
  where: SQL | undefined;
  orderBy: SQL[];
  limit: number;
  /** Select this as `cursorValue`: the sort value as Postgres's own text, so the cursor compares exactly. */
  cursorValue: SQL<string>;
};

export type KeysetResult<T> = {
  rows: T[];
  /** Pass as `after` to load the next page. Null on the last page. */
  nextCursor: string | null;
  /** Pass as `before` to load the previous page. Null on the first page. */
  prevCursor: string | null;
};

export async function keysetPage<R extends { id: number; cursorValue: string }>(
  options: KeysetOptions,
  query: (keyset: KeysetQuery) => Promise<R[]>,
): Promise<KeysetResult<Omit<R, "cursorValue">>> {
  const { sort } = options;
  const limit = Math.min(Math.max(options.limit ?? PAGE_SIZE, 1), PAGE_SIZE);
  // `before` walks backwards, so both the comparison and the order flip, and
  // the rows are reversed afterwards.
  const after = decodeCursor(options.after, sort);
  const before = after ? null : decodeCursor(options.before, sort);
  const cursor = after ?? before;
  const backwards = before !== null;
  const ascending = (sort.direction === "ASC") !== backwards;
  const direction = ascending ? asc : desc;

  const page = await query({
    where: and(
      options.filters,
      cursor
        ? sql`(${sort.value}, ${sort.id}) ${ascending ? sql`>` : sql`<`} (${cursor[0]}::${sql.raw(sort.cast)}, ${cursor[1]}::bigint)`
        : undefined,
    ),
    orderBy: [direction(sort.value), direction(sort.id)],
    // One extra row, to learn whether another page follows.
    limit: limit + 1,
    // A float4 goes through float8 first: its own text is rounded when the server
    // runs with extra_float_digits = 0, and would not cast back to the same rank.
    cursorValue: sort.cast === "float4" ? sql<string>`${sort.value}::float8::text` : sql<string>`${sort.value}::text`,
  });

  const hasMore = page.length > limit;
  const rows = page.slice(0, limit);
  if (backwards) rows.reverse();
  const first = rows[0];
  const last = rows[rows.length - 1];
  const hasNext = backwards ? rows.length > 0 : hasMore;
  const hasPrev = backwards ? hasMore : after !== null && rows.length > 0;

  return {
    rows: rows.map(withoutCursorValue),
    nextCursor: hasNext && last ? encodeCursor(sort, last.cursorValue, last.id) : null,
    prevCursor: hasPrev && first ? encodeCursor(sort, first.cursorValue, first.id) : null,
  };
}

/** The caller's row, less the column the module asked it to select. */
function withoutCursorValue<R extends { cursorValue: string }>(row: R): Omit<R, "cursorValue"> {
  const rest: Partial<R> = { ...row };
  delete rest.cursorValue;
  return rest as Omit<R, "cursorValue">;
}

function encodeCursor(sort: KeysetSort, value: string, id: number): string {
  return Buffer.from(JSON.stringify([sort.key, value, id])).toString("base64url");
}

function decodeCursor(cursor: string | undefined, sort: KeysetSort): [string, number] | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [key, value, id] = parsed;
    if (key !== sort.key) return null;
    if (typeof value !== "string" || !VALUE_SHAPES[sort.cast].test(value)) return null;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) return null;
    return [value, id];
  } catch {
    return null;
  }
}
