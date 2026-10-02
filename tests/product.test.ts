import { beforeAll, describe, expect, test } from "bun:test";
import { getPool } from "../src/db/client";
import { findProductBySlug, findProductOffer, listProductSlugs, splitDescription } from "../src/lib/products";
import { insertCategory, insertProduct, resetTables } from "./helpers";

const pool = getPool();
let productId: number;

beforeAll(async () => {
  await resetTables();
  const tools = await insertCategory("tools", "Tools");
  productId = await insertProduct({
    slug: "claw-hammer",
    title: "Claw Hammer",
    description: "Forged steel head.\n\nBrand: Anvil\nWarranty: 2 year warranty",
    categoryId: tools,
    priceCents: 1899,
    stock: 3,
    ratingAvg: 4.5,
    ratingCount: 120,
  });
  await insertProduct({ slug: "steel-ruler", title: "Steel Ruler", categoryId: tools });
});

describe("product lookups", () => {
  test("find the content by slug, with its category", async () => {
    const product = await findProductBySlug(pool, "claw-hammer");
    expect(product).toMatchObject({
      id: productId,
      title: "Claw Hammer",
      ratingAvg: 4.5,
      ratingCount: 120,
      categorySlug: "tools",
      categoryName: "Tools",
    });
  });

  test("return null for a slug that does not exist", async () => {
    expect(await findProductBySlug(pool, "no-such-product")).toBeNull();
    expect(await findProductOffer(pool, 999999)).toBeNull();
  });

  test("read price and stock separately from the content", async () => {
    expect(await findProductOffer(pool, productId)).toEqual({ priceCents: 1899, stock: 3 });
  });

  test("list every slug for prerendering", async () => {
    expect(await listProductSlugs(pool)).toEqual(["claw-hammer", "steel-ruler"]);
  });
});

describe("splitDescription", () => {
  test("separates prose from label and value lines", () => {
    expect(splitDescription("Forged steel head.\n\nBrand: Anvil\nWarranty: 2 year warranty")).toEqual({
      paragraphs: ["Forged steel head."],
      facts: [
        ["Brand", "Anvil"],
        ["Warranty", "2 year warranty"],
      ],
    });
  });

  test("keeps a paragraph that merely contains a colon", () => {
    expect(splitDescription("Note: this one is prose, not a fact\nand it runs on.").facts).toEqual([]);
  });
});
