"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { removeFromCartAction, setCartQuantityAction } from "@/app/actions/cart";
import { placeOrderAction, type CheckoutState, type ShippingField } from "@/app/actions/checkout";
import { summarize, type CartLine } from "@/lib/cart-lines";
import { formatPrice } from "@/lib/format";

const FIELDS: Array<{ name: ShippingField; label: string; autoComplete: string; wide: boolean }> = [
  { name: "name", label: "Full name", autoComplete: "name", wide: true },
  { name: "street", label: "Street address", autoComplete: "street-address", wide: true },
  { name: "city", label: "Town or city", autoComplete: "address-level2", wide: false },
  { name: "postcode", label: "Postcode", autoComplete: "postal-code", wide: false },
];

/**
 * The whole checkout: shipping details, the order, and one button (SPEC.md
 * 10.4). When stock ran out for something in the cart, the page names the item
 * and how many are left, and offers the fix as a single click.
 */
export function CheckoutForm({ lines }: { lines: CartLine[] }) {
  const [state, submit, placing] = useActionState<CheckoutState, FormData>(placeOrderAction, { status: "idle" });
  const cart = summarize(lines);
  const short = lines.filter((line) => line.quantity > line.stock);

  return (
    <form action={submit} noValidate className="grid gap-8 lg:grid-cols-[1fr_24rem] lg:gap-12">
      <div>
        {short.length > 0 ? <ShortStock lines={short} justFound={state.status === "short"} /> : null}
        {state.status === "error" ? (
          <p role="alert" className="mb-6 rounded-md border border-alert px-4 py-3 font-medium text-alert">
            The order was not placed and nothing was taken from stock. Try again.
          </p>
        ) : null}

        <fieldset>
          <legend className="text-lg font-semibold">Where should it go?</legend>
          <div className="mt-4 grid max-w-xl gap-4 sm:grid-cols-2">
            {FIELDS.map((field) => {
              const error = state.errors?.[field.name];
              return (
                <div key={field.name} className={field.wide ? "sm:col-span-2" : ""}>
                  <label htmlFor={field.name} className="block font-medium">
                    {field.label}
                  </label>
                  <input
                    id={field.name}
                    name={field.name}
                    type="text"
                    required
                    autoComplete={field.autoComplete}
                    defaultValue={state.values?.[field.name] ?? ""}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${field.name}-error` : undefined}
                    className={`mt-1 h-11 w-full rounded-md border bg-paper px-3 text-base ${
                      error ? "border-alert" : "border-ink/40"
                    }`}
                  />
                  {error ? (
                    <p id={`${field.name}-error`} className="mt-1 text-sm font-medium text-alert">
                      {error}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </fieldset>
      </div>

      <aside aria-labelledby="order-heading" className="h-fit rounded-md bg-shelf p-5">
        <h2 id="order-heading" className="text-lg font-semibold">
          Your order
        </h2>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {cart.lines.map((line) => (
            <li key={line.productId} className="flex justify-between gap-4 py-2.5">
              <span className="min-w-0">
                <span className="block truncate">{line.title}</span>
                <span className="text-sm text-muted">
                  {line.quantity} × {formatPrice(line.priceCents)}
                </span>
              </span>
              <span className="type-narrow shrink-0 font-semibold">{formatPrice(line.priceCents * line.quantity)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-baseline justify-between gap-4">
          <span className="font-semibold">Total</span>
          <span className="type-narrow text-3xl font-bold">{formatPrice(cart.subtotalCents)}</span>
        </p>
        <p className="mt-1 text-sm text-muted">This is a demo store. There is no payment step and nothing is charged.</p>

        <button
          type="submit"
          disabled={placing || short.length > 0}
          className="mt-4 w-full rounded-md bg-pine px-5 py-3.5 text-lg font-semibold text-white hover:bg-pine-deep disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
        >
          {placing ? "Placing your order…" : "Place your order"}
        </button>
        {short.length > 0 ? (
          <p className="mt-2 text-sm font-medium text-alert">Fix the stock problem above to place your order.</p>
        ) : null}
        <p className="mt-3 text-center text-sm">
          <Link href="/cart" className="underline underline-offset-4 hover:text-pine">
            Change what is in your cart
          </Link>
        </p>
      </aside>
    </form>
  );
}

function ShortStock({ lines, justFound }: { lines: CartLine[]; justFound: boolean }) {
  const [, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function fix(line: CartLine) {
    setFailed(false);
    startTransition(async () => {
      const result =
        line.stock > 0
          ? await setCartQuantityAction(line.productId, line.stock)
          : await removeFromCartAction(line.productId);
      if (!result.ok) setFailed(true);
    });
  }

  return (
    <div role="alert" className="mb-6 rounded-md border-2 border-ink bg-tag/40 p-4">
      <h2 className="font-semibold">
        {justFound ? "Your order was not placed. " : ""}
        {lines.length === 1 ? "One item does not have enough stock." : "Some items do not have enough stock."}
      </h2>
      <ul className="mt-3 space-y-3">
        {lines.map((line) => (
          <li key={line.productId} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <span>
              <span className="font-medium">{line.title}</span>:{" "}
              {line.stock > 0
                ? `you asked for ${line.quantity}, and ${line.stock === 1 ? "only 1 is" : `only ${line.stock} are`} left.`
                : "it has sold out."}
            </span>
            <button
              type="button"
              onClick={() => fix(line)}
              className="rounded-md border border-ink bg-paper px-3 py-2 font-semibold hover:bg-ink hover:text-white"
            >
              {line.stock > 0 ? `Change to ${line.stock}` : "Remove it"}
            </button>
          </li>
        ))}
      </ul>
      {failed ? <p className="mt-3 font-medium text-alert">That did not save. Try again.</p> : null}
    </div>
  );
}
