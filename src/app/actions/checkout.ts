"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/drizzle";
import { placeOrder } from "@/lib/orders";
import { getVisitorId } from "@/lib/visitor";

export type ShippingField = "name" | "street" | "city" | "postcode";

export type CheckoutState = {
  status: "idle" | "invalid" | "short" | "empty" | "error";
  errors?: Partial<Record<ShippingField, string>>;
  /** What was typed, so a failed submit does not clear the form. */
  values?: Partial<Record<ShippingField, string>>;
};

const LIMITS: Record<ShippingField, number> = { name: 100, street: 200, city: 100, postcode: 20 };
const REQUIRED: Record<ShippingField, string> = {
  name: "Enter the name of the person receiving the order.",
  street: "Enter a street address.",
  city: "Enter a town or city.",
  postcode: "Enter a postcode.",
};

export async function placeOrderAction(_previous: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const values = {} as Record<ShippingField, string>;
  const errors: Partial<Record<ShippingField, string>> = {};
  for (const field of Object.keys(LIMITS) as ShippingField[]) {
    const raw = formData.get(field);
    values[field] = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
    if (!values[field]) errors[field] = REQUIRED[field];
    else if (values[field].length > LIMITS[field]) errors[field] = `Use ${LIMITS[field]} characters or fewer.`;
  }
  if (Object.keys(errors).length > 0) return { status: "invalid", errors, values };

  const visitorId = await getVisitorId();
  if (!visitorId) return { status: "empty", values };

  let result;
  try {
    result = await placeOrder(getDb(), visitorId, {
      name: values.name,
      address: `${values.street}\n${values.city} ${values.postcode}`,
    });
  } catch (error) {
    console.error("placeOrder failed", error);
    return { status: "error", values };
  }

  if (!result.ok) {
    if (result.reason === "short") {
      // The pages for these products are showing more stock than there is.
      for (const item of result.shortItems) updateTag(`product:${item.productId}`);
    }
    refresh();
    return { status: result.reason, values };
  }

  // After the commit, every product in the order has less stock than its cached pages say.
  for (const productId of result.productIds) updateTag(`product:${productId}`);
  redirect(`/orders/${result.orderId}?placed=1`);
}
