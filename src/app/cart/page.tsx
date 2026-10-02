import type { Metadata } from "next";
import { Suspense } from "react";
import { CartView, EmptyCart } from "@/components/cart-view";
import { getPool } from "@/db/client";
import { getCart } from "@/lib/cart";
import { getVisitorId } from "@/lib/visitor";

export const metadata: Metadata = { title: "Cart" };

export default function CartPage() {
  return (
    <div className="container-page pt-6 md:pt-8">
      <h1 className="type-wide text-2xl font-bold md:text-3xl">Cart</h1>
      <div className="mt-6">
        {/* The cart is per visitor: read on every request, never cached (SPEC.md 6.5). */}
        <Suspense fallback={<CartSkeleton />}>
          <CartContents />
        </Suspense>
      </div>
    </div>
  );
}

async function CartContents() {
  const visitorId = await getVisitorId();
  if (!visitorId) return <EmptyCart />;
  const cart = await getCart(getPool(), visitorId);
  return <CartView lines={cart.lines} />;
}

function CartSkeleton() {
  return (
    <div role="status" aria-label="Loading your cart" className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:gap-12">
      <div className="divide-y divide-line border-y border-line">
        {[0, 1].map((i) => (
          <div key={i} className="flex gap-4 py-5">
            <div className="size-24 animate-pulse rounded-md bg-shelf" />
            <div className="flex-1">
              <div className="h-5 w-2/3 animate-pulse rounded bg-shelf" />
              <div className="mt-2 h-4 w-24 animate-pulse rounded bg-shelf" />
            </div>
          </div>
        ))}
      </div>
      <div className="h-44 animate-pulse rounded-md bg-shelf" />
    </div>
  );
}
