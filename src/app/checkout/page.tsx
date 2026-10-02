import type { Metadata } from "next";
import { Suspense } from "react";
import { EmptyCart } from "@/components/cart-view";
import { CheckoutForm } from "@/components/checkout-form";
import { getPool } from "@/db/client";
import { getCart } from "@/lib/cart";
import { getVisitorId } from "@/lib/visitor";

export const metadata: Metadata = { title: "Checkout" };

export default function CheckoutPage() {
  return (
    <div className="container-page pt-6 md:pt-8">
      <h1 className="type-wide text-2xl font-bold md:text-3xl">Checkout</h1>
      <div className="mt-6">
        {/* Per visitor and read fresh on every request, so stock here is current (SPEC.md 6.5). */}
        <Suspense fallback={<CheckoutSkeleton />}>
          <CheckoutContents />
        </Suspense>
      </div>
    </div>
  );
}

async function CheckoutContents() {
  const visitorId = await getVisitorId();
  const cart = visitorId ? await getCart(getPool(), visitorId) : null;
  if (!cart || cart.lines.length === 0) return <EmptyCart />;
  return <CheckoutForm lines={cart.lines} />;
}

function CheckoutSkeleton() {
  return (
    <div role="status" aria-label="Loading checkout" className="grid gap-8 lg:grid-cols-[1fr_24rem] lg:gap-12">
      <div className="max-w-xl space-y-4">
        <div className="h-6 w-48 animate-pulse rounded bg-shelf" />
        <div className="h-11 animate-pulse rounded-md bg-shelf" />
        <div className="h-11 animate-pulse rounded-md bg-shelf" />
        <div className="h-11 animate-pulse rounded-md bg-shelf" />
      </div>
      <div className="h-64 animate-pulse rounded-md bg-shelf" />
    </div>
  );
}
