"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/drizzle";
import { stockChanged } from "@/lib/catalog";
import { checkout, SHIPPING_FIELDS, type ShippingField } from "@/lib/checkout";
import { getVisitorId } from "@/lib/visitor";

export type CheckoutState = {
  status: "idle" | "invalid" | "short" | "empty" | "error";
  errors?: Partial<Record<ShippingField, string>>;
  /** What was typed, so a failed submit does not clear the form. */
  values?: Partial<Record<ShippingField, string>>;
};

export async function placeOrderAction(_previous: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const fields = Object.fromEntries(formData);
  const visitorId = await getVisitorId();
  let result;
  try {
    result = await checkout(getDb(), visitorId, fields, stockChanged);
  } catch (error) {
    console.error("checkout failed", error);
    return { status: "error", values: asTyped(fields) };
  }

  if (result.status === "placed") redirect(`/orders/${result.orderId}?placed=1`);
  if (result.status === "invalid") return { status: "invalid", errors: result.errors, values: result.values };
  // The page reads the cart again, with stock as it is now, and names the short items itself.
  refresh();
  return { status: result.status, values: result.values };
}

/** The shipping fields as typed: checkout threw, so it sent no cleaned ones back. */
function asTyped(fields: Record<string, unknown>): CheckoutState["values"] {
  const values: CheckoutState["values"] = {};
  for (const field of SHIPPING_FIELDS) {
    const value = fields[field];
    if (typeof value === "string") values[field] = value;
  }
  return values;
}
