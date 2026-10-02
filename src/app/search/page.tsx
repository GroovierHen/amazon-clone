import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ProductGrid, ProductGridSkeleton } from "@/components/product-card";
import { SearchQuerySync } from "@/components/search-query-sync";
import { getCategories, getProductList } from "@/lib/catalog";
import { formatCount, searchHref } from "@/lib/format";
import { normalizeQuery, resolveSort, SORT_LABELS, SORTS, type ListResult } from "@/lib/products";

export const metadata: Metadata = { title: "Search" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="container-page pt-6 md:pt-8">
      {/* The query string is only known per request, so the results stream in. */}
      <Suspense fallback={<ResultsSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function Results({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const q = normalizeQuery(one(raw.q));
  const categories = await getCategories();
  const category = categories.find((c) => c.slug === one(raw.category));
  const sort = resolveSort(one(raw.sort), q !== "");

  const result = await getProductList({
    q: q || undefined,
    category: category?.slug,
    sort,
    after: one(raw.after),
    before: one(raw.before),
  });

  // Links keep the query, aisle and sort; changing any of them goes back to page one.
  const base = { q, category: category?.slug, sort: sort === resolveSort(undefined, q !== "") ? undefined : sort };

  return (
    <>
      <SearchQuerySync q={q} />
      <h1 className="type-wide text-2xl font-bold md:text-3xl">{heading(q, category?.name)}</h1>
      <p className="mt-1 text-muted" role="status">
        {summary(result, q)}
      </p>

      <div className="mt-5 space-y-2 border-y border-line py-3">
        <FilterRow label="Aisle">
          <Chip href={searchHref({ ...base, category: undefined })} active={!category}>
            All aisles
          </Chip>
          {categories.map((c) => (
            <Chip key={c.slug} href={searchHref({ ...base, category: c.slug })} active={c.slug === category?.slug}>
              {c.name}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="Sort by">
          {SORTS.filter((s) => s !== "relevance" || q).map((s) => (
            <Chip key={s} href={searchHref({ ...base, sort: s })} active={s === sort}>
              {SORT_LABELS[s]}
            </Chip>
          ))}
        </FilterRow>
      </div>

      {result.items.length > 0 ? (
        <>
          <div className="mt-8">
            <ProductGrid products={result.items} />
          </div>
          {result.prevCursor || result.nextCursor ? (
            <nav aria-label="Result pages" className="mt-12 flex items-center justify-between gap-4">
              <PageLink href={result.prevCursor ? searchHref({ ...base, before: result.prevCursor }) : null}>
                Previous
              </PageLink>
              <PageLink href={result.nextCursor ? searchHref({ ...base, after: result.nextCursor }) : null}>
                Next
              </PageLink>
            </nav>
          ) : null}
        </>
      ) : (
        <NoResults q={q} categoryName={category?.name} allAislesHref={searchHref({ ...base, category: undefined })} />
      )}
    </>
  );
}

function heading(q: string, categoryName: string | undefined): string {
  if (q && categoryName) return `“${q}” in ${categoryName}`;
  if (q) return `“${q}”`;
  return categoryName ?? "All products";
}

function summary(result: ListResult, q: string): string {
  const count = `${formatCount(result.total)} ${result.total === 1 ? "product" : "products"}`;
  if (result.match === "fuzzy" && result.total > 0) {
    return `Nothing matches “${q}” exactly. Showing ${count} with a similar name.`;
  }
  return count;
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-sm font-semibold">{label}</span>
      <ul className="scroll-row min-w-0 gap-2 py-1 pr-1">{children}</ul>
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <li className="shrink-0">
      <Link
        href={href}
        aria-current={active ? "true" : undefined}
        className={
          active
            ? "block rounded-full border border-ink bg-ink px-3 py-1.5 text-sm font-medium text-white"
            : "block rounded-full border border-line px-3 py-1.5 text-sm font-medium hover:border-ink"
        }
      >
        {children}
      </Link>
    </li>
  );
}

function PageLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  const shape = "min-w-28 rounded-md border px-5 py-2.5 text-center font-semibold";
  if (!href) {
    return (
      <span aria-disabled="true" className={`${shape} border-line text-muted/60`}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={`${shape} border-ink hover:bg-ink hover:text-white`}>
      {children}
    </Link>
  );
}

const primaryButton = "rounded-md bg-pine px-4 py-2.5 font-semibold text-white hover:bg-pine-deep";
const secondaryButton = "rounded-md border border-ink px-4 py-2.5 font-semibold hover:bg-ink hover:text-white";

function NoResults({
  q,
  categoryName,
  allAislesHref,
}: {
  q: string;
  categoryName: string | undefined;
  allAislesHref: string;
}) {
  return (
    <div className="mt-10 max-w-xl">
      <h2 className="text-xl font-semibold">
        {q ? `No products match “${q}”${categoryName ? ` in ${categoryName}` : ""}.` : "This aisle is empty."}
      </h2>
      <p className="mt-2 text-muted">
        {q
          ? "Check the spelling or try a shorter, more general word. Search looks at product names and descriptions."
          : "Nothing is stocked here at the moment."}
      </p>
      <p className="mt-5 flex flex-wrap gap-3">
        {categoryName && q ? (
          <>
            <Link href={allAislesHref} className={primaryButton}>
              Search all aisles
            </Link>
            <Link href="/search" className={secondaryButton}>
              Browse all products
            </Link>
          </>
        ) : (
          <Link href="/search" className={primaryButton}>
            Browse all products
          </Link>
        )}
      </p>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div role="status" aria-label="Loading products">
      <div className="h-8 w-56 animate-pulse rounded bg-shelf" />
      <div className="mt-3 h-5 w-28 animate-pulse rounded bg-shelf" />
      <div className="mt-5 h-24 border-y border-line" />
      <div className="mt-8">
        <ProductGridSkeleton />
      </div>
    </div>
  );
}
