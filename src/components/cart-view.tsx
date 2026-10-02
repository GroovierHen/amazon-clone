"use client";

import Image from "next/image";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { removeFromCartAction, setCartQuantityAction } from "@/app/actions/cart";
import { MAX_LINE_QUANTITY, summarize, type CartLine } from "@/lib/cart-lines";
import { formatPrice } from "@/lib/format";
import { usePendingCart } from "./cart-provider";

type Change = { productId: number; quantity: number };

/**
 * The cart's lines and total. Quantity changes and removals are applied to the
 * list on click with useOptimistic, then confirmed by the server (SPEC.md 6.3).
 */
export function CartView({ lines }: { lines: CartLine[] }) {
  const { addPending } = usePendingCart();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimisticLines, applyChange] = useOptimistic(lines, (current: CartLine[], change: Change) =>
    change.quantity <= 0
      ? current.filter((line) => line.productId !== change.productId)
      : current.map((line) => (line.productId === change.productId ? { ...line, quantity: change.quantity } : line)),
  );
  const cart = summarize(optimisticLines);

  function change(line: CartLine, quantity: number) {
    setError(null);
    startTransition(async () => {
      applyChange({ productId: line.productId, quantity });
      addPending(Math.max(quantity, 0) - line.quantity);
      const result =
        quantity <= 0
          ? await removeFromCartAction(line.productId)
          : await setCartQuantityAction(line.productId, quantity);
      if (!result.ok) setError(result.message);
    });
  }

  if (cart.lines.length === 0) return <EmptyCart />;

  const short = cart.lines.filter((line) => line.quantity > line.stock);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:gap-12">
      <div>
        {error ? (
          <p role="alert" className="mb-4 rounded-md border border-alert px-4 py-3 font-medium text-alert">
            {error}
          </p>
        ) : null}
        <ul className="divide-y divide-line border-y border-line">
          {cart.lines.map((line) => (
            <CartRow key={line.productId} line={line} onChange={(quantity) => change(line, quantity)} />
          ))}
        </ul>
      </div>

      <aside aria-labelledby="summary-heading" className="h-fit rounded-md bg-shelf p-5">
        <h2 id="summary-heading" className="text-lg font-semibold">
          Order summary
        </h2>
        <dl className="mt-3 space-y-1">
          <div className="flex justify-between gap-4">
            <dt>
              {cart.count} {cart.count === 1 ? "item" : "items"}
            </dt>
            <dd className="type-narrow text-2xl font-bold">{formatPrice(cart.subtotalCents)}</dd>
          </div>
        </dl>
        <p className="mt-1 text-sm text-muted">This is a demo store. Nothing is charged.</p>
        {short.length > 0 ? (
          <p className="mt-3 text-sm font-medium text-alert">
            Lower the quantity of {short.length === 1 ? "the marked item" : "the marked items"} before you check out.
          </p>
        ) : null}
        <Link
          href="/checkout"
          className="mt-4 block rounded-md bg-pine px-5 py-3.5 text-center text-lg font-semibold text-white hover:bg-pine-deep"
        >
          Go to checkout
        </Link>
      </aside>
    </div>
  );
}

function CartRow({ line, onChange }: { line: CartLine; onChange: (quantity: number) => void }) {
  const limit = Math.min(line.stock, MAX_LINE_QUANTITY);
  const short = line.quantity > line.stock;
  const stepper = "grid size-10 place-items-center text-xl font-semibold hover:bg-shelf disabled:text-line disabled:hover:bg-transparent";

  return (
    <li className="grid grid-cols-[5rem_1fr] gap-x-4 gap-y-3 py-5 sm:grid-cols-[6rem_1fr_auto]">
      <div className="relative row-span-2 aspect-square self-start overflow-hidden rounded-md bg-shelf sm:row-span-1">
        {line.imageUrl ? <Image src={line.imageUrl} alt="" fill sizes="96px" className="object-contain p-1.5" /> : null}
      </div>

      <div className="min-w-0">
        <h3 className="font-medium leading-snug">
          <Link href={`/product/${line.slug}`} className="hover:underline">
            {line.title}
          </Link>
        </h3>
        <p className="mt-1 text-sm text-muted">{formatPrice(line.priceCents)} each</p>
        {short ? (
          <p className="mt-2 text-sm">
            <span className="rounded-sm bg-tag px-1.5 py-0.5 font-semibold">
              {line.stock > 0 ? `Only ${line.stock} left` : "Out of stock"}
            </span>
          </p>
        ) : line.quantity >= line.stock ? (
          <p className="mt-2 text-sm text-muted">That is all we have.</p>
        ) : null}
      </div>

      <div className="col-start-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 sm:col-start-3 sm:flex-col sm:items-end sm:justify-start">
        <p className="type-narrow text-xl font-bold">{formatPrice(line.priceCents * line.quantity)}</p>
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-md border border-ink/40">
            <button
              type="button"
              className={`${stepper} rounded-l-md`}
              aria-label={`Decrease quantity of ${line.title}`}
              onClick={() => onChange(line.quantity - 1)}
            >
              −
            </button>
            <span className="type-narrow min-w-9 text-center font-semibold" aria-label={`Quantity ${line.quantity}`}>
              {line.quantity}
            </span>
            <button
              type="button"
              className={`${stepper} rounded-r-md`}
              aria-label={`Increase quantity of ${line.title}`}
              disabled={line.quantity >= limit}
              onClick={() => onChange(line.quantity + 1)}
            >
              +
            </button>
          </div>
          <button
            type="button"
            className="rounded-md px-2 py-2 text-sm font-medium underline underline-offset-4 hover:text-alert"
            aria-label={`Remove ${line.title} from cart`}
            onClick={() => onChange(0)}
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

export function EmptyCart() {
  return (
    <div className="max-w-xl">
      <p className="text-lg">Your cart is empty.</p>
      <p className="mt-1 text-muted">Add something from any product page and it will show up here.</p>
      <Link
        href="/search"
        className="mt-5 inline-block rounded-md bg-pine px-4 py-2.5 font-semibold text-white hover:bg-pine-deep"
      >
        Browse all products
      </Link>
    </div>
  );
}
