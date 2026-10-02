"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { addToCartAction } from "@/app/actions/cart";
import { usePendingCart } from "./cart-provider";

/**
 * The main action on a product page. The confirmation and the header count
 * appear on click, before the server answers; if the server says no, the
 * confirmation is replaced by the reason.
 */
export function AddToCartButton({ productId, stock }: { productId: number; stock: number }) {
  const { addPending } = usePendingCart();
  const [, startTransition] = useTransition();
  const [added, setAdded] = useState(0);
  const [optimisticAdded, addOptimistic] = useOptimistic(added, (current: number, n: number) => current + n);
  const [error, setError] = useState<string | null>(null);

  if (stock <= 0) {
    return (
      <button
        type="button"
        disabled
        className="mt-5 w-full cursor-not-allowed rounded-md bg-shelf px-5 py-3.5 text-lg font-semibold text-muted"
      >
        Out of stock
      </button>
    );
  }

  function add() {
    setError(null);
    startTransition(async () => {
      addOptimistic(1);
      addPending(1);
      const result = await addToCartAction(productId, 1);
      if (result.ok) setAdded((n) => n + 1);
      else setError(result.message);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={add}
        className="mt-5 w-full rounded-md bg-pine px-5 py-3.5 text-lg font-semibold text-white hover:bg-pine-deep"
      >
        Add to cart
      </button>
      <div aria-live="polite" className="min-h-7 pt-2">
        {error ? (
          <p role="alert" className="font-medium text-alert">
            {error}
          </p>
        ) : optimisticAdded > 0 ? (
          <p>
            <span className="font-medium">{optimisticAdded === 1 ? "Added to your cart." : `Added ${optimisticAdded} to your cart.`}</span>{" "}
            <Link href="/cart" className="font-medium text-pine underline underline-offset-4 hover:text-pine-deep">
              View cart
            </Link>
          </p>
        ) : null}
      </div>
    </>
  );
}
