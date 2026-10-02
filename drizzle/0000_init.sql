-- Schema for SPEC.md section 4. Table names are unqualified on purpose: the app
-- runs with the default search_path (public) and tests run with search_path = test.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE TABLE categories (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE products (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL,
  category_id integer NOT NULL REFERENCES categories (id),
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  stock integer NOT NULL CHECK (stock >= 0),
  rating_avg numeric(2, 1) NOT NULL DEFAULT 0,
  rating_count integer NOT NULL DEFAULT 0,
  image_urls text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', description), 'B')
  ) STORED
);

CREATE INDEX products_search_idx ON products USING gin (search);
CREATE INDEX products_title_trgm_idx ON products USING gin (title public.gin_trgm_ops);
CREATE INDEX products_price_idx ON products (price_cents, id);
CREATE INDEX products_created_idx ON products (created_at DESC, id DESC);
CREATE INDEX products_rating_idx ON products (rating_avg DESC, id DESC);
CREATE INDEX products_category_idx ON products (category_id, id);

CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cart_items (
  cart_id uuid NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES products (id),
  quantity integer NOT NULL CHECK (quantity > 0),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cart_id, product_id)
);

CREATE TABLE orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  visitor_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'placed',
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  shipping_name text NOT NULL,
  shipping_address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_visitor_idx ON orders (visitor_id, created_at DESC, id DESC);

CREATE TABLE order_items (
  order_id bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES products (id),
  quantity integer NOT NULL CHECK (quantity > 0),
  title text NOT NULL,
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  PRIMARY KEY (order_id, product_id)
);
