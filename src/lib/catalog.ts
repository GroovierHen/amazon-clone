import { cacheLife, cacheTag } from "next/cache";
import { getPool } from "@/db/client";
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

/**
 * Title, description, images and rating: cached for days under the product's
 * tag. A slug with no product is cached too, under `products`, so a reseed
 * clears it.
 */
export async function getProductContent(slug: string): Promise<ProductContent | null> {
  "use cache";
  cacheLife("days");
  const product = await findProductBySlug(getPool(), slug);
  cacheTag(product ? `product:${product.id}` : "products");
  return product;
}

/** Price and stock: same tag, much shorter lifetime than the content (SPEC.md 6.5). */
export async function getProductOffer(id: number): Promise<ProductOffer | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`product:${id}`);
  return findProductOffer(getPool(), id);
}

export async function getProductSlugs(): Promise<string[]> {
  "use cache";
  cacheLife("days");
  cacheTag("products");
  return listProductSlugs(getPool());
}
