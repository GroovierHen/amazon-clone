"use client";

import { createContext, use, useOptimistic } from "react";

/**
 * Holds the cart changes that have been clicked but not yet confirmed by the
 * server, as a difference in item count. The header adds it to the last count
 * the server sent, so the number moves the moment a button is pressed
 * (SPEC.md 6.3). It returns to zero when the action finishes and the fresh
 * count arrives.
 */
type CartContextValue = {
  pendingCount: number;
  /** Call inside a transition, before awaiting the Server Action. */
  addPending: (delta: number) => void;
};

const CartContext = createContext<CartContextValue>({ pendingCount: 0, addPending: () => {} });

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [pendingCount, addPending] = useOptimistic(0, (current: number, delta: number) => current + delta);
  return <CartContext value={{ pendingCount, addPending }}>{children}</CartContext>;
}

export function usePendingCart(): CartContextValue {
  return use(CartContext);
}

/** The number next to "Cart" in the header. */
export function CartCountBadge({ count }: { count: number }) {
  const { pendingCount } = usePendingCart();
  const shown = Math.max(0, count + pendingCount);
  return (
    <>
      <span
        aria-hidden="true"
        className={`type-narrow ml-1.5 inline-flex min-w-6 justify-center rounded-full px-1.5 text-sm font-bold ${
          shown > 0 ? "bg-pine text-white" : "bg-shelf text-muted"
        }`}
      >
        {shown}
      </span>
      <span className="sr-only">
        , {shown} {shown === 1 ? "item" : "items"}
      </span>
    </>
  );
}
