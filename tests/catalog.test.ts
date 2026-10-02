import { describe, expect, test } from "bun:test";
import { buildCatalog, slugify } from "../seed/catalog";

describe("seed catalog", () => {
  const { categories, products } = buildCatalog();

  test("has at least 200 products across 8 categories", () => {
    expect(products.length).toBeGreaterThanOrEqual(200);
    expect(categories).toHaveLength(8);
    const used = new Set(products.map((p) => p.categorySlug));
    expect([...used].sort()).toEqual(categories.map((c) => c.slug).sort());
  });

  test("gives every product a unique slug", () => {
    const slugs = products.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test("stores money as whole cents and ratings to one decimal", () => {
    for (const p of products) {
      expect(Number.isInteger(p.priceCents)).toBe(true);
      expect(p.priceCents).toBeGreaterThan(0);
      expect(Number.isInteger(p.stock)).toBe(true);
      expect(p.stock).toBeGreaterThanOrEqual(0);
      expect(Math.round(p.ratingAvg * 10)).toBeCloseTo(p.ratingAvg * 10, 6);
      expect(p.imageUrls.length).toBeGreaterThan(0);
    }
  });

  test("is the same on every run", () => {
    expect(buildCatalog().products).toEqual(products);
  });
});

test("slugify drops punctuation and accents", () => {
  expect(slugify("Woven Storage Baskets, Set of 3")).toBe("woven-storage-baskets-set-of-3");
  expect(slugify("  Café & Crème  ")).toBe("cafe-creme");
});
