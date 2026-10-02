import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Mirrors drizzle/0000_init.sql, which is the source of truth for the database.

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

export const categories = pgTable("categories", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const products = pgTable(
  "products",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    priceCents: integer("price_cents").notNull(),
    stock: integer("stock").notNull(),
    ratingAvg: numeric("rating_avg", { precision: 2, scale: 1 }).notNull().default("0"),
    ratingCount: integer("rating_count").notNull().default(0),
    imageUrls: text("image_urls")
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', description), 'B')`,
    ),
  },
  (t) => [
    check("products_price_cents_check", sql`${t.priceCents} >= 0`),
    check("products_stock_check", sql`${t.stock} >= 0`),
    index("products_search_idx").using("gin", t.search),
    index("products_title_trgm_idx").using("gin", sql`${t.title} public.gin_trgm_ops`),
    index("products_price_idx").on(t.priceCents, t.id),
    index("products_created_idx").on(t.createdAt.desc(), t.id.desc()),
    index("products_rating_idx").on(t.ratingAvg.desc(), t.id.desc()),
    index("products_category_idx").on(t.categoryId, t.id),
  ],
);

export const carts = pgTable("carts", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitorId: uuid("visitor_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cartItems = pgTable(
  "cart_items",
  {
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => products.id),
    quantity: integer("quantity").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.cartId, t.productId] }),
    check("cart_items_quantity_check", sql`${t.quantity} > 0`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    visitorId: uuid("visitor_id").notNull(),
    status: text("status").notNull().default("placed"),
    totalCents: integer("total_cents").notNull(),
    shippingName: text("shipping_name").notNull(),
    shippingAddress: text("shipping_address").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("orders_total_cents_check", sql`${t.totalCents} >= 0`),
    index("orders_visitor_idx").on(t.visitorId, t.createdAt.desc(), t.id.desc()),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    orderId: bigint("order_id", { mode: "number" })
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => products.id),
    quantity: integer("quantity").notNull(),
    title: text("title").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.productId] }),
    check("order_items_quantity_check", sql`${t.quantity} > 0`),
    check("order_items_unit_price_cents_check", sql`${t.unitPriceCents} >= 0`),
  ],
);
