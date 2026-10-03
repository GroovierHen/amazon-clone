import { cacheLife, cacheTag, updateTag } from "next/cache";
import { getDb } from "@/db/drizzle";
import {
  findProductBySlug,
  findProductOffer,
  listCategories,
  listProducts,
  listProductSlugs,
  type CategorySummary,
  type ListParams,
  type ListResult,
  type ProductContent,
  type ProductOffer,
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
  const result = await listProducts(getDb(), params);
  cacheTag("products", ...result.items.map((item) => productTag(item.id)));
  return result;
}

/** Category names and counts change only when the catalog is reseeded. */
export async function getCategories(): Promise<CategorySummary[]> {
  "use cache";
  cacheLife("days");
  cacheTag("products");
  return listCategories(getDb());
}

/**
 * Title, description, images and rating: cached for days under the product's
 * tag. A slug with no product is cached too, under `products`, so a reseed
 * clears it.
 */
export async function getProductContent(slug: string): Promise<ProductContent | null> {
  "use cache";
  cacheLife("days");
  const product = await findProductBySlug(getDb(), slug);
  cacheTag(product ? productTag(product.id) : "products");
  return product;
}

/** Price and stock: same tag, much shorter lifetime than the content (SPEC.md 6.5). */
export async function getProductOffer(id: number): Promise<ProductOffer | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(productTag(id));
  return findProductOffer(getDb(), id);
}

export async function getProductSlugs(): Promise<string[]> {
  "use cache";
  cacheLife("days");
  cacheTag("products");
  return listProductSlugs(getDb());
}

/** The tag on every cached read that shows this product. */
function productTag(id: number): string {
  return `product:${id}`;
}

/**
 * These products' stock changed, or their cached pages show stock there is
 * not: the next request reads them fresh. Call it only from a Server Action,
 * the one place `updateTag` works.
 */
export function stockChanged(productIds: number[]): void {
  for (const id of productIds) updateTag(productTag(id));
}
