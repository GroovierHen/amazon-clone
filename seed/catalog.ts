import dataset from "./dummyjson-products.json";
import { extraProducts } from "./stockroom-extras";

export type SeedCategory = { slug: string; name: string };

export type SeedProduct = {
  slug: string;
  title: string;
  description: string;
  categorySlug: string;
  priceCents: number;
  stock: number;
  ratingAvg: number;
  ratingCount: number;
  imageUrls: string[];
  createdAt: Date;
};

export const seedCategories: SeedCategory[] = [
  { slug: "electronics", name: "Electronics" },
  { slug: "fashion", name: "Fashion" },
  { slug: "kitchen", name: "Kitchen" },
  { slug: "groceries", name: "Groceries" },
  { slug: "sports-outdoors", name: "Sports and Outdoors" },
  { slug: "beauty", name: "Beauty" },
  { slug: "home-furniture", name: "Home and Furniture" },
  { slug: "automotive", name: "Automotive" },
];

/** The dataset's 24 narrow categories folded into the store's 8. */
const categoryForSource: Record<string, string> = {
  laptops: "electronics",
  smartphones: "electronics",
  tablets: "electronics",
  "mobile-accessories": "electronics",
  "mens-shirts": "fashion",
  "mens-shoes": "fashion",
  "mens-watches": "fashion",
  tops: "fashion",
  "womens-bags": "fashion",
  "womens-dresses": "fashion",
  "womens-jewellery": "fashion",
  "womens-shoes": "fashion",
  "womens-watches": "fashion",
  "kitchen-accessories": "kitchen",
  groceries: "groceries",
  "sports-accessories": "sports-outdoors",
  sunglasses: "sports-outdoors",
  beauty: "beauty",
  fragrances: "beauty",
  "skin-care": "beauty",
  furniture: "home-furniture",
  "home-decoration": "home-furniture",
  motorcycle: "automotive",
  vehicle: "automotive",
};

// Fixed so that seeding twice gives the same rows.
const NEWEST = Date.UTC(2026, 8, 30, 12);
const DAY = 24 * 60 * 60 * 1000;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Small deterministic hash, used to spread rating counts and dates. */
function spread(n: number): number {
  return (Math.imul(n + 1, 2654435761) >>> 0) % 100000;
}

function details(lines: Array<[string, string | null | undefined]>): string {
  return lines
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

export function buildCatalog(): { categories: SeedCategory[]; products: SeedProduct[] } {
  const products: SeedProduct[] = [];
  const taken = new Set<string>();

  const uniqueSlug = (title: string) => {
    const base = slugify(title);
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    return slug;
  };

  for (const p of dataset.products) {
    const categorySlug = categoryForSource[p.sourceCategory];
    if (!categorySlug) throw new Error(`No category mapping for "${p.sourceCategory}"`);
    const facts = details([
      ["Brand", p.brand],
      ["Warranty", p.warranty],
      ["Shipping", p.shipping],
      ["Returns", p.returns],
    ]);
    products.push({
      slug: uniqueSlug(p.title),
      title: p.title,
      description: facts ? `${p.description}\n\n${facts}` : p.description,
      categorySlug,
      priceCents: Math.round(p.price * 100),
      stock: p.stock,
      ratingAvg: Math.round(p.rating * 10) / 10,
      ratingCount: 12 + (spread(p.sourceId) % 4800),
      imageUrls: p.images,
      // Whole days, so several products share a timestamp and sorting has ties to break.
      createdAt: new Date(NEWEST - (spread(p.sourceId * 7) % 180) * DAY),
    });
  }

  extraProducts.forEach((p, i) => {
    const slug = uniqueSlug(p.title);
    products.push({
      slug,
      title: p.title,
      description: `${p.description}\n\n${details([
        ["Brand", "Stockroom Basics"],
        ["Warranty", "1 year warranty"],
        ["Shipping", "Ships in 1-2 business days"],
        ["Returns", "30 days return policy"],
      ])}`,
      categorySlug: p.category,
      priceCents: Math.round(p.price * 100),
      stock: p.stock,
      ratingAvg: p.rating,
      ratingCount: 12 + (spread(1000 + i) % 900),
      imageUrls: [`/seed/${slug}.svg`],
      createdAt: new Date(NEWEST - (spread((1000 + i) * 7) % 180) * DAY),
    });
  });

  return { categories: seedCategories, products };
}
