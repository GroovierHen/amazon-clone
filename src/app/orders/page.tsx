import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getPool } from "@/db/client";
import { formatDate, formatPrice } from "@/lib/format";
import { listOrders } from "@/lib/orders";
import { getVisitorId } from "@/lib/visitor";

export const metadata: Metadata = { title: "Orders" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="container-page pt-6 md:pt-8">
      <h1 className="type-wide text-2xl font-bold md:text-3xl">Orders</h1>
      <div className="mt-6">
        {/* Orders are per visitor: read on every request, never cached (SPEC.md 6.5). */}
        <Suspense fallback={<OrdersSkeleton />}>
          <OrderList searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function OrderList({ searchParams }: { searchParams: SearchParams }) {
  const [visitorId, raw] = await Promise.all([getVisitorId(), searchParams]);
  const list = visitorId
    ? await listOrders(getPool(), visitorId, { after: one(raw.after), before: one(raw.before) })
    : null;

  if (!list || list.orders.length === 0) {
    return (
      <div className="max-w-xl">
        <p className="text-lg">You have not placed an order yet.</p>
        <p className="mt-1 text-muted">
          Orders are kept for this browser. There are no accounts, so they will not show up on another device.
        </p>
        <Link
          href="/search"
          className="mt-5 inline-block rounded-md bg-pine px-4 py-2.5 font-semibold text-white hover:bg-pine-deep"
        >
          Browse all products
        </Link>
      </div>
    );
  }

  return (
    <>
      <ul className="max-w-3xl divide-y divide-line border-y border-line">
        {list.orders.map((order) => (
          <li key={order.id}>
            <Link href={`/orders/${order.id}`} className="group flex items-start justify-between gap-6 py-4 hover:bg-shelf sm:px-3">
              <span className="min-w-0">
                <span className="block font-semibold group-hover:underline">Order {order.id}</span>
                <span className="block text-sm text-muted">Placed {formatDate(order.createdAt)}</span>
                <span className="mt-1 block truncate">
                  {order.titles.join(", ")}
                  {order.itemCount > order.titles.length ? " and more" : ""}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="type-narrow block text-xl font-bold">{formatPrice(order.totalCents)}</span>
                <span className="text-sm text-muted">
                  {order.itemCount} {order.itemCount === 1 ? "item" : "items"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {list.prevCursor || list.nextCursor ? (
        <nav aria-label="Order pages" className="mt-8 flex max-w-3xl items-center justify-between gap-4">
          <PageLink href={list.prevCursor ? `/orders?before=${list.prevCursor}` : null}>Newer</PageLink>
          <PageLink href={list.nextCursor ? `/orders?after=${list.nextCursor}` : null}>Older</PageLink>
        </nav>
      ) : null}
    </>
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

function OrdersSkeleton() {
  return (
    <div role="status" aria-label="Loading your orders" className="max-w-3xl divide-y divide-line border-y border-line">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex justify-between gap-6 py-4">
          <div className="flex-1">
            <div className="h-5 w-28 animate-pulse rounded bg-shelf" />
            <div className="mt-2 h-4 w-56 animate-pulse rounded bg-shelf" />
          </div>
          <div className="h-6 w-20 animate-pulse rounded bg-shelf" />
        </div>
      ))}
    </div>
  );
}
