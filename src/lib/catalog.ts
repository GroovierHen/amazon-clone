import { cacheLife, cacheTag } from "next/cache";
import { getPool } from "@/db/client";
import {
  listCategories,
  listProducts,
  type CategorySummary,
  type ListParams,
  type ListResult,
} from "./products";

/**
 * Cached reads for pages (SPEC.md 6.5). Product lists carry the `products` tag
 * and the tag of every product on the page, so an order that changes stock
 * refreshes the lists that show it. Lists include price and stock, so they get
 * the short `minutes` lifetime.
 */
export async function getProductList(params: ListParams): Promise<ListResult> {
  "use cache";
  cacheLife("minutes");
  const result = await listProducts(getPool(), params);
  cacheTag("products", ...result.items.map((item) => `product:${item.id}`));
  return result;
}

/** Category names and counts change only when the catalog is reseeded. */
export async function getCategories(): Promise<CategorySummary[]> {
  "use cache";
  cacheLife("days");
  cacheTag("products");
  return listCategories(getPool());
}
