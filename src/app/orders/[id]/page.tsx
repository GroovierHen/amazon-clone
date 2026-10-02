import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/db/drizzle";
import { formatDate, formatPrice } from "@/lib/format";
import { getOrder } from "@/lib/orders";
import { getVisitorId } from "@/lib/visitor";

export const metadata: Metadata = { title: "Order" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function OrderPage(props: Props) {
  return (
    <div className="container-page pt-6 md:pt-8">
      {/* Per visitor and never cached (SPEC.md 6.5). */}
      <Suspense fallback={<OrderSkeleton />}>
        <OrderDetails {...props} />
      </Suspense>
    </div>
  );
}

async function OrderDetails({ params, searchParams }: Props) {
  const [{ id }, query, visitorId] = await Promise.all([params, searchParams, getVisitorId()]);
  const order = visitorId && /^\d{1,15}$/.test(id) ? await getOrder(getDb(), visitorId, Number(id)) : null;
  if (!order) notFound();

  return (
    <article>
      {query.placed ? (
        <p role="status" className="mb-6 max-w-3xl rounded-md border-2 border-pine bg-shelf px-4 py-3 text-lg font-semibold">
          Your order is placed. The items below have been taken off the shelf for you.
        </p>
      ) : null}

      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/orders" className="underline underline-offset-4 hover:text-ink">
          Orders
        </Link>
      </nav>
      <h1 className="type-wide mt-3 text-2xl font-bold md:text-3xl">Order {order.id}</h1>
      <p className="mt-1 text-muted">Placed {formatDate(order.createdAt)}</p>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_22rem] lg:gap-12">
        <section aria-labelledby="items-heading">
          <h2 id="items-heading" className="sr-only">
            Items
          </h2>
          <ul className="divide-y divide-line border-y border-line">
            {order.items.map((item) => (
              <li key={item.productId} className="flex gap-4 py-4">
                <div className="relative size-20 shrink-0 overflow-hidden rounded-md bg-shelf">
                  {item.imageUrl ? (
                    <Image src={item.imageUrl} alt="" fill sizes="80px" className="object-contain p-1.5" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium leading-snug">
                    <Link href={`/product/${item.slug}`} className="hover:underline">
                      {item.title}
                    </Link>
                  </h3>
                  <p className="mt-1 text-sm text-muted">
                    {item.quantity} × {formatPrice(item.unitPriceCents)}
                  </p>
                </div>
                <p className="type-narrow shrink-0 text-lg font-bold">
                  {formatPrice(item.unitPriceCents * item.quantity)}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-4 flex items-baseline justify-between gap-4">
            <span className="font-semibold">Total</span>
            <span className="type-narrow text-3xl font-bold">{formatPrice(order.totalCents)}</span>
          </p>
        </section>

        <aside aria-labelledby="shipping-heading" className="h-fit rounded-md bg-shelf p-5">
          <h2 id="shipping-heading" className="text-lg font-semibold">
            Shipping to
          </h2>
          <address className="mt-2 whitespace-pre-line not-italic">
            {order.shippingName}
            {"\n"}
            {order.shippingAddress}
          </address>
          <p className="mt-4 text-sm text-muted">This is a demo store. Nothing was charged and nothing will be shipped.</p>
          <Link
            href="/search"
            className="mt-4 block rounded-md bg-pine px-4 py-2.5 text-center font-semibold text-white hover:bg-pine-deep"
          >
            Keep shopping
          </Link>
        </aside>
      </div>
    </article>
  );
}

function OrderSkeleton() {
  return (
    <div role="status" aria-label="Loading order">
      <div className="h-4 w-16 animate-pulse rounded bg-shelf" />
      <div className="mt-3 h-9 w-48 animate-pulse rounded bg-shelf" />
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_22rem] lg:gap-12">
        <div className="h-48 animate-pulse rounded-md bg-shelf" />
        <div className="h-40 animate-pulse rounded-md bg-shelf" />
      </div>
    </div>
  );
}
