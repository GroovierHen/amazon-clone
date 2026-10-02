import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/drizzle";
import { categories, products } from "@/db/schema";

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
  /** Which field of the `matched` rows is the sort value. */
  field: "rank" | "priceCents" | "ratingAvg" | "createdAt";
  /** Postgres type the cursor's sort value is cast back to. */
  cast: "float4" | "integer" | "numeric" | "timestamptz";
  direction: "ASC" | "DESC";
  /** Shape a cursor's sort value must have before it is sent to Postgres. */
  valid: RegExp;
};

const SORT_SPECS: Record<SortKey, SortSpec> = {
  relevance: { field: "rank", cast: "float4", direction: "DESC", valid: /^-?\d+(\.\d+)?(e-?\d+)?$/ },
  "price-asc": { field: "priceCents", cast: "integer", direction: "ASC", valid: /^\d+$/ },
  "price-desc": { field: "priceCents", cast: "integer", direction: "DESC", valid: /^\d+$/ },
  rating: { field: "ratingAvg", cast: "numeric", direction: "DESC", valid: /^\d+(\.\d+)?$/ },
  newest: { field: "createdAt", cast: "timestamptz", direction: "DESC", valid: /^[\d\-:.+ ]+$/ },
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

export async function listProducts(db: Db, params: ListParams): Promise<ListResult> {
  const q = normalizeQuery(params.q);
  const sort = resolveSort(params.sort, q !== "");
  const spec = SORT_SPECS[sort];
  const limit = Math.min(Math.max(params.limit ?? PAGE_SIZE, 1), PAGE_SIZE);

  // 1. Which rows match. Full-text search first, trigram similarity on the
  //    title only when full-text search finds nothing at all (SPEC.md 6.2).
  let match: ListResult["match"] = "all";
  let rank: SQL<number> = sql<number>`0::float4`;
  const conditions: Array<SQL | undefined> = [];
  if (q) {
    // A name that contains the query text also counts as a match, so "phone"
    // finds "iPhone". Those rows rank below the full-text matches.
    const inTitle = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const textMatch = or(
      sql`${products.search} @@ websearch_to_tsquery('english', ${q})`,
      ilike(products.title, inTitle),
    );
    const found = await db.select({ id: products.id }).from(products).where(textMatch).limit(1);
    if (found.length > 0) {
      match = "text";
      rank = sql<number>`ts_rank(${products.search}, websearch_to_tsquery('english', ${q}))`;
      conditions.push(textMatch);
    } else {
      match = "fuzzy";
      rank = sql<number>`public.word_similarity(${q}, ${products.title})`;
      conditions.push(sql`public.word_similarity(${q}, ${products.title}) >= ${FUZZY_THRESHOLD}`);
    }
  }
  if (params.category) {
    conditions.push(
      eq(products.categoryId, db.select({ id: categories.id }).from(categories).where(eq(categories.slug, params.category))),
    );
  }

  const matched = db.$with("matched").as(
    db
      .select({
        id: products.id,
        slug: products.slug,
        title: products.title,
        priceCents: products.priceCents,
        stock: products.stock,
        ratingAvg: products.ratingAvg,
        ratingCount: products.ratingCount,
        imageUrl: sql<string | null>`${products.imageUrls}[1]`.as("image_url"),
        createdAt: products.createdAt,
        rank: rank.as("rank"),
      })
      .from(products)
      .where(and(...conditions)),
  );

  // 2. Which side of the cursor. `before` walks backwards, so both the
  //    comparison and the order flip, and the rows are reversed afterwards.
  const after = decodeCursor(params.after, spec);
  const before = after ? null : decodeCursor(params.before, spec);
  const cursor = after ?? before;
  const backwards = before !== null;
  const ascending = (spec.direction === "ASC") !== backwards;
  const direction = ascending ? asc : desc;
  const sortValue = matched[spec.field];

  const [page, count] = await Promise.all([
    db
      .with(matched)
      .select({
        id: matched.id,
        slug: matched.slug,
        title: matched.title,
        priceCents: matched.priceCents,
        stock: matched.stock,
        ratingAvg: matched.ratingAvg,
        ratingCount: matched.ratingCount,
        imageUrl: matched.imageUrl,
        // Postgres's own text for the sort value, so the cursor compares exactly.
        sortValue: sql<string>`${sortValue}::text`,
      })
      .from(matched)
      .where(
        cursor
          ? sql`(${sortValue}, ${matched.id}) ${ascending ? sql`>` : sql`<`} (${cursor[0]}::${sql.raw(spec.cast)}, ${cursor[1]}::bigint)`
          : undefined,
      )
      .orderBy(direction(sortValue), direction(matched.id))
      .limit(limit + 1),
    db.with(matched).select({ total: sql<number>`count(*)::int` }).from(matched),
  ]);

  // 3. One extra row was requested to learn whether another page follows.
  const hasMore = page.length > limit;
  const rows = page.slice(0, limit);
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
      priceCents: r.priceCents,
      stock: r.stock,
      ratingAvg: Number(r.ratingAvg),
      ratingCount: r.ratingCount,
      imageUrl: r.imageUrl,
    })),
    nextCursor: hasNext && last ? encodeCursor(last.sortValue, last.id) : null,
    prevCursor: hasPrev && first ? encodeCursor(first.sortValue, first.id) : null,
    total: count[0].total,
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

export async function listCategories(db: Db): Promise<CategorySummary[]> {
  const inCategory = eq(products.categoryId, categories.id);
  const productCount = sql<number>`${db
    .select({ n: sql`count(*)::int` })
    .from(products)
    .where(inCategory)}`.as("product_count");
  const bestRatedPhoto = db
    .select({ url: sql`${products.imageUrls}[1]` })
    .from(products)
    .where(and(inCategory, sql`${products.imageUrls}[1] LIKE 'http%'`))
    .orderBy(desc(products.ratingAvg), desc(products.id))
    .limit(1);

  return db
    .select({
      slug: categories.slug,
      name: categories.name,
      productCount,
      imageUrl: sql<string | null>`${bestRatedPhoto}`,
    })
    .from(categories)
    .orderBy(desc(productCount), categories.name);
}

/** The slow-changing part of a product: what it is. */
export type ProductContent = {
  id: number;
  slug: string;
  title: string;
  description: string;
  imageUrls: string[];
  ratingAvg: number;
  ratingCount: number;
  categorySlug: string;
  categoryName: string;
};

/** The fast-changing part of a product: what it costs and how many are left. */
export type ProductOffer = {
  priceCents: number;
  stock: number;
};

export async function findProductBySlug(db: Db, slug: string): Promise<ProductContent | null> {
  const [row] = await db
    .select({
      id: products.id,
      slug: products.slug,
      title: products.title,
      description: products.description,
      imageUrls: products.imageUrls,
      ratingAvg: products.ratingAvg,
      ratingCount: products.ratingCount,
      categorySlug: categories.slug,
      categoryName: categories.name,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(products.slug, slug));
  return row ? { ...row, ratingAvg: Number(row.ratingAvg) } : null;
}

export async function findProductOffer(db: Db, id: number): Promise<ProductOffer | null> {
  const [row] = await db
    .select({ priceCents: products.priceCents, stock: products.stock })
    .from(products)
    .where(eq(products.id, id));
  return row ?? null;
}

export async function listProductSlugs(db: Db): Promise<string[]> {
  const rows = await db.select({ slug: products.slug }).from(products).orderBy(products.id);
  return rows.map((r) => r.slug);
}

/**
 * Seed descriptions are a paragraph or two, then "Label: value" lines.
 * Splits them so the page can show prose as prose and facts as a list.
 */
export function splitDescription(description: string): { paragraphs: string[]; facts: Array<[string, string]> } {
  const paragraphs: string[] = [];
  const facts: Array<[string, string]> = [];
  for (const block of description.split(/\n{2,}/)) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const pairs = lines.map((line) => line.match(/^([A-Z][A-Za-z ]{1,24}): (.+)$/));
    if (lines.length > 0 && pairs.every(Boolean)) {
      for (const pair of pairs) facts.push([pair![1], pair![2]]);
    } else if (lines.length > 0) {
      paragraphs.push(lines.join(" "));
    }
  }
  return { paragraphs, facts };
}
