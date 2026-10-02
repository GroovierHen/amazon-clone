import type { Pool } from "pg";

/**
 * Product list queries. Every list is keyset paginated (SPEC.md 6.1): the
 * cursor is the sort value and id of the row at the edge of the page, and the
 * next page is "rows strictly beyond that pair". OFFSET is never used.
 */

export const PAGE_SIZE = 24;

export const SORTS = ["relevance", "price-asc", "price-desc", "rating", "newest"] as const;
export type SortKey = (typeof SORTS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  relevance: "Best match",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
  rating: "Top rated",
  newest: "Newest",
};

export type ProductCard = {
  id: number;
  slug: string;
  title: string;
  priceCents: number;
  stock: number;
  ratingAvg: number;
  ratingCount: number;
  imageUrl: string | null;
};

export type ListParams = {
  q?: string;
  category?: string;
  sort?: string;
  after?: string;
  before?: string;
  limit?: number;
};

export type ListResult = {
  items: ProductCard[];
  /** Pass as `after` to load the next page. Null on the last page. */
  nextCursor: string | null;
  /** Pass as `before` to load the previous page. Null on the first page. */
  prevCursor: string | null;
  total: number;
  sort: SortKey;
  /** "fuzzy" means full-text search found nothing and trigram matching was used. */
  match: "all" | "text" | "fuzzy";
};

type SortSpec = {
  /** SQL expression for the sort value, over the `matched` CTE. */
  expr: string;
  /** Postgres type the cursor's sort value is cast back to. */
  cast: string;
  direction: "ASC" | "DESC";
  /** Shape a cursor's sort value must have before it is sent to Postgres. */
  valid: RegExp;
};

const SORT_SPECS: Record<SortKey, SortSpec> = {
  relevance: { expr: "rank", cast: "float4", direction: "DESC", valid: /^-?\d+(\.\d+)?(e-?\d+)?$/ },
  "price-asc": { expr: "price_cents", cast: "integer", direction: "ASC", valid: /^\d+$/ },
  "price-desc": { expr: "price_cents", cast: "integer", direction: "DESC", valid: /^\d+$/ },
  rating: { expr: "rating_avg", cast: "numeric", direction: "DESC", valid: /^\d+(\.\d+)?$/ },
  newest: { expr: "created_at", cast: "timestamptz", direction: "DESC", valid: /^[\d\-:.+ ]+$/ },
};

/** How close a title has to be to the query for the typo-tolerant fallback. */
const FUZZY_THRESHOLD = 0.45;

export function encodeCursor(sortValue: string, id: number): string {
  return Buffer.from(JSON.stringify([sortValue, id])).toString("base64url");
}

export function decodeCursor(cursor: string | undefined, spec: SortSpec): [string, number] | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [value, id] = parsed;
    if (typeof value !== "string" || !spec.valid.test(value)) return null;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) return null;
    return [value, id];
  } catch {
    return null;
  }
}

export function normalizeQuery(q: string | undefined): string {
  return (q ?? "").trim().replace(/\s+/g, " ").slice(0, 100);
}

export function resolveSort(sort: string | undefined, hasQuery: boolean): SortKey {
  const known = SORTS.find((s) => s === sort);
  if (known && (known !== "relevance" || hasQuery)) return known;
  return hasQuery ? "relevance" : "newest";
}

type Row = {
  id: number;
  slug: string;
  title: string;
  price_cents: number;
  stock: number;
  rating_avg: string;
  rating_count: number;
  image_url: string | null;
  sort_value: string;
};

export async function listProducts(pool: Pool, params: ListParams): Promise<ListResult> {
  const q = normalizeQuery(params.q);
  const sort = resolveSort(params.sort, q !== "");
  const spec = SORT_SPECS[sort];
  const limit = Math.min(Math.max(params.limit ?? PAGE_SIZE, 1), PAGE_SIZE);

  const values: unknown[] = [];
  const bind = (value: unknown) => `$${values.push(value)}`;

  // 1. Which rows match. Full-text search first, trigram similarity on the
  //    title only when full-text search finds nothing at all (SPEC.md 6.2).
  let match: ListResult["match"] = "all";
  let matched = "SELECT p.*, 0::float4 AS rank FROM products p";
  if (q) {
    // A name that contains the query text also counts as a match, so "phone"
    // finds "iPhone". Those rows rank below the full-text matches.
    const inTitle = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const { rows } = await pool.query<{ found: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM products
         WHERE search @@ websearch_to_tsquery('english', $1) OR title ILIKE $2
       ) AS found`,
      [q, inTitle],
    );
    if (rows[0].found) {
      match = "text";
      const query = bind(q);
      matched = `SELECT p.*, ts_rank(p.search, websearch_to_tsquery('english', ${query})) AS rank
                 FROM products p
                 WHERE (p.search @@ websearch_to_tsquery('english', ${query}) OR p.title ILIKE ${bind(inTitle)})`;
    } else {
      match = "fuzzy";
      const query = bind(q);
      matched = `SELECT p.*, public.word_similarity(${query}, p.title) AS rank
                 FROM products p
                 WHERE public.word_similarity(${query}, p.title) >= ${bind(FUZZY_THRESHOLD)}`;
    }
  }
  if (params.category) {
    matched += `${q ? " AND" : " WHERE"} p.category_id = (SELECT id FROM categories WHERE slug = ${bind(params.category)})`;
  }

  // 2. Which side of the cursor. `before` walks backwards, so both the
  //    comparison and the order flip, and the rows are reversed afterwards.
  const after = decodeCursor(params.after, spec);
  const before = after ? null : decodeCursor(params.before, spec);
  const cursor = after ?? before;
  const backwards = before !== null;
  const forwardOp = spec.direction === "ASC" ? ">" : "<";
  const op = backwards ? (forwardOp === ">" ? "<" : ">") : forwardOp;
  const order = backwards ? (spec.direction === "ASC" ? "DESC" : "ASC") : spec.direction;

  const countValues = [...values];
  const where = cursor
    ? `WHERE (${spec.expr}, id) ${op} (${bind(cursor[0])}::${spec.cast}, ${bind(cursor[1])}::bigint)`
    : "";

  const [page, count] = await Promise.all([
    pool.query<Row>(
      `WITH matched AS (${matched})
       SELECT id, slug, title, price_cents, stock, rating_avg, rating_count,
              image_urls[1] AS image_url, (${spec.expr})::text AS sort_value
       FROM matched
       ${where}
       ORDER BY ${spec.expr} ${order}, id ${order}
       LIMIT ${bind(limit + 1)}`,
      values,
    ),
    pool.query<{ total: number }>(
      `WITH matched AS (${matched}) SELECT count(*)::int AS total FROM matched`,
      countValues,
    ),
  ]);

  // 3. One extra row was requested to learn whether another page follows.
  const hasMore = page.rows.length > limit;
  const rows = page.rows.slice(0, limit);
  if (backwards) rows.reverse();

  const first = rows[0];
  const last = rows[rows.length - 1];
  const hasNext = backwards ? rows.length > 0 : hasMore;
  const hasPrev = backwards ? hasMore : after !== null && rows.length > 0;

  return {
    items: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      priceCents: r.price_cents,
      stock: r.stock,
      ratingAvg: Number(r.rating_avg),
      ratingCount: r.rating_count,
      imageUrl: r.image_url,
    })),
    nextCursor: hasNext && last ? encodeCursor(last.sort_value, last.id) : null,
    prevCursor: hasPrev && first ? encodeCursor(first.sort_value, first.id) : null,
    total: count.rows[0].total,
    sort,
    match,
  };
}

export type CategorySummary = {
  slug: string;
  name: string;
  productCount: number;
  /** Photo of the category's best-rated product, used on the home page. */
  imageUrl: string | null;
};

export async function listCategories(pool: Pool): Promise<CategorySummary[]> {
  const { rows } = await pool.query<{
    slug: string;
    name: string;
    product_count: number;
    image_url: string | null;
  }>(
    `SELECT c.slug, c.name,
            (SELECT count(*)::int FROM products p WHERE p.category_id = c.id) AS product_count,
            (SELECT p.image_urls[1] FROM products p
              WHERE p.category_id = c.id AND p.image_urls[1] LIKE 'http%'
              ORDER BY p.rating_avg DESC, p.id DESC LIMIT 1) AS image_url
     FROM categories c
     ORDER BY product_count DESC, c.name`,
  );
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    productCount: r.product_count,
    imageUrl: r.image_url,
  }));
}
