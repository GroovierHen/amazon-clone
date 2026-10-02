"use server";

import { refresh } from "next/cache";
import { getPool } from "@/db/client";
import { addToCart, removeFromCart, setCartQuantity } from "@/lib/cart";
import { ensureVisitorId, getVisitorId } from "@/lib/visitor";

export type CartActionResult = { ok: true } | { ok: false; message: string };

const FAILED: CartActionResult = { ok: false, message: "That did not save. Try again." };

export async function addToCartAction(productId: number, quantity = 1): Promise<CartActionResult> {
  if (!Number.isSafeInteger(productId) || !Number.isSafeInteger(quantity) || quantity < 1) return FAILED;
  const visitorId = await ensureVisitorId();
  const added = await addToCart(getPool(), visitorId, productId, quantity);
  if (!added) return { ok: false, message: "This product is no longer stocked." };
  refresh();
  return { ok: true };
}

export async function setCartQuantityAction(productId: number, quantity: number): Promise<CartActionResult> {
  if (!Number.isSafeInteger(productId) || !Number.isSafeInteger(quantity)) return FAILED;
  const visitorId = await getVisitorId();
  if (!visitorId) return FAILED;
  await setCartQuantity(getPool(), visitorId, productId, quantity);
  refresh();
  return { ok: true };
}

export async function removeFromCartAction(productId: number): Promise<CartActionResult> {
  if (!Number.isSafeInteger(productId)) return FAILED;
  const visitorId = await getVisitorId();
  if (!visitorId) return FAILED;
  await removeFromCart(getPool(), visitorId, productId);
  refresh();
  return { ok: true };
}
