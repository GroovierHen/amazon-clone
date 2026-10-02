# Amazon clone spec

## Status

The brief is in section 10. If section 10 conflicts with sections 1 to 9, section 10 wins.
Do not start slice 1 until the agent capture test in slice 0 passes.

## 1. Goal

A rebuild of the amazon.com storefront for a hiring assessment, with a 24 hour window.
The brief asks for a product that uses Amazon as a reference, not a pixel copy.
The reviewers judge speed, product judgement, and UX and UI.

One Next.js app and one Postgres database. No microservices, no Redis, no separate search engine.

## 2. Scope

In scope:

- Home page with category navigation and product grids
- Search by product name, with category filter and sort
- Product page with title, images, description, price, rating, stock status
- Cart with add, change quantity, remove
- Checkout with a shipping form and a "Place your order" button. No payment step.
- Stock check when the order is placed, stock decrement on success
- Order history and order detail
- The product decisions in section 10

Out of scope unless section 10 says otherwise:

- Payment of any kind
- Login and accounts. A cookie identifies the visitor.
- Seller pages, admin pages, writing reviews, recommendations, wish lists, emails
- Redis, Elasticsearch, message queues, microservices

## 3. Stack

- Bun for installs, scripts and the runtime. Use `bun` and `bunx`. Do not use npm or npx.
- Next.js 16, current stable 16.3.x, App Router, TypeScript in strict mode
- React Server Components, Server Actions, Suspense, useOptimistic
- Cache Components turned on with `cacheComponents: true`
- PostgreSQL on Neon, provisioned through the Vercel Marketplace
- Drizzle ORM with SQL migrations
- Tailwind CSS
- `bun test` for unit and integration tests
- Playwright for end-to-end tests and screenshots. Playwright's test runner needs Node. If Node is missing, stop and tell me.
- Hosting on Vercel

Read the Next.js docs for the installed version before writing any caching code.
Do not write `use cache`, `cacheTag`, `cacheLife` or `updateTag` from memory.

### 3.1 Vercel setup

The Vercel CLI is installed and logged in. Run `vercel link` if the folder is not linked to a project.

Database:

- Provision it with `vercel install neon --plan free`. The command creates the Postgres database, connects it to the project and writes the connection variables to `.env.local`.
- Read `.env.local` to learn the variable names. Never print the values and never commit the file.
- Use the pooled connection for the app. Use the unpooled connection for migrations if the integration provides one.
- The place-order transaction is interactive. Use a driver that supports interactive transactions, such as node-postgres or the Neon serverless Pool. Do not use the Neon HTTP driver for it.
- Tests run in a separate Postgres schema named `test`. Tests must never touch the schema the app reads.

Cost:

- Use free plans only. Never choose a paid plan or add a paid resource. Stop and ask instead.

Cache and storage:

- Do not create a cache service. Next.js Cache Components on Vercel is the cache.
- Do not create file storage. Seed images live in `/public` or load from the dataset's own URLs through `remotePatterns`. Add Vercel Blob only if section 10 needs file uploads.

Bun on Vercel:

- Add `vercel.json` with `"bunVersion": "1.x"`.
- Set the scripts to `bun --bun next dev` and `bun --bun next build`.
- The Bun runtime on Vercel is in Beta. If a deploy fails because of it, remove `bunVersion`, keep Bun for installs and scripts, and tell me.

Deploy:

- Run migrations and the seed script against the Neon database before the first deploy.
- Preview with `vercel deploy`. Production with `vercel deploy --prod`.

## 4. Data model

Store money as integer cents.

categories

- id, slug unique, name

products

- id bigint identity
- slug unique, title, description
- category_id references categories
- price_cents integer
- stock integer, with CHECK stock >= 0
- rating_avg numeric(2,1), rating_count integer. Seed data only.
- image_urls text array
- created_at
- search tsvector, generated and stored. Title has weight A, description has weight B.

carts

- id uuid, visitor_id uuid unique, created_at, updated_at

cart_items

- cart_id, product_id, quantity with CHECK quantity > 0
- primary key on cart_id and product_id

orders

- id, visitor_id, status, total_cents
- shipping_name, shipping_address
- created_at

order_items

- order_id, product_id, quantity
- title and unit_price_cents copied from the product when the order is placed

Indexes:

- GIN on products.search
- GIN trigram on products.title, using the pg_trgm extension
- btree on products (price_cents, id)
- btree on products (created_at desc, id desc)
- btree on products (rating_avg desc, id desc)
- btree on products (category_id, id)
- btree on orders (visitor_id, created_at desc, id desc)

## 5. Routes

- `/` home
- `/search?q=&category=&sort=&after=&before=` results
- `/product/[slug]` product page
- `/cart`
- `/checkout`
- `/orders` and `/orders/[id]`

## 6. Rules

### 6.1 Pagination

Keyset only. Never use OFFSET.

- The cursor is the pair of sort value and id, encoded as an opaque base64url string.
- `after` loads the next page. `before` loads the previous page.
- Show Next and Previous links. No numbered pages.
- Page size is 24.
- Sort options are price low to high, price high to low, rating, newest, and relevance. Relevance exists only when `q` is set.
- For relevance, compute `ts_rank` in a CTE and apply the keyset condition on rank and id.

### 6.2 Search

- Parse the query with `websearch_to_tsquery('english', q)`.
- Rank with `ts_rank`.
- If full-text search returns no rows, fall back to trigram similarity on title.

### 6.3 Cart

- Create the visitor_id cookie on the first add to cart. Make it httpOnly.
- Change the cart only through Server Actions.
- Use useOptimistic so the cart count and line items update before the server responds.
- The cart shows the current product price. The price is fixed only when the order is placed.

### 6.4 Place order

One database transaction, in this order:

1. Read the cart items.
2. Lock the product rows with `SELECT ... FOR UPDATE`, in ascending product id order. The fixed order prevents deadlocks between two carts that share products.
3. Check that every quantity is less than or equal to stock. If any item is short, roll back and return the list of short items.
4. Decrement stock.
5. Insert the order and its order_items with the title and price copied from the product.
6. Delete the cart items.
7. Commit.

After the commit, invalidate the cache tags of every product in the order.

### 6.5 Caching

- Cache product content with the tag `product:{id}`.
- Cache product lists with the tag `products`.
- Give price and stock a shorter cache lifetime than title, description and images.
- Never put the cart, the cart count, checkout or orders in the shared cache. Render them inside Suspense so the rest of the page stays static.

### 6.6 Images

- Use `next/image` with a `sizes` value on every product image.
- Set `preload` only on the main image at the top of the product page. Next.js 16 deprecates `priority` in favour of it.

### 6.7 Look and content

- Use Amazon for the shape of the flows: browse, search, product page, cart, checkout, orders. Do not copy its visual design.
- Give the store its own name, colors and type. The name is in section 10.
- If `/reference` exists, use its screenshots to understand Amazon's flows. Do not match them pixel for pixel.
- Do not download Amazon's logo files, product photos or product text.
- Seed at least 200 products across 8 categories so pagination and search have real work to do.
- Take seed data from a public sample product dataset if one is reachable. Otherwise generate it with a script and local placeholder images.

## 7. Checks

Every slice ends with these passing:

- `bun run typecheck`
- `bun run lint`
- `bun run build`
- `bun test`

Tests that must exist by the end:

- Keyset pagination. Walking forward through every page returns each product once. Walking backward returns the same pages. Products with equal sort values are neither skipped nor repeated.
- Search. Full-text match, ranking order, trigram fallback.
- Cart actions. Add, change quantity, remove.
- Order transaction. Success path, and the short-stock path leaves stock and cart unchanged.
- Concurrency. One product with stock 1, ten carts, ten parallel place-order calls. Exactly one succeeds and stock ends at 0.
- End to end with Playwright. Search, open a product, add to cart, place the order, see it in order history, confirm stock dropped by the ordered quantity.

UX check, for every page:

- Screenshot it at 1440px and 390px wide and look at the result.
- Nothing overflows or overlaps at either width.
- Loading, empty and error states exist and read clearly.
- Every action is reachable by keyboard and has a visible focus state.
- The main action on the page is the most prominent thing on it.

## 8. Build order

Tick each box when the slice passes its checks, then commit.

- [x] 0. Agent capture setup from section 10. The capture test passes and `.agent-logs/` is committed.
- [x] 1. Project setup with Bun, Vercel link, Neon database, schema, migrations, seed script
- [x] 2. Home page, search results with keyset pagination, search
- [x] 3. Product page
- [x] 4. Cart
- [x] 5. Checkout, place order transaction, order history
- [x] 6. Product decisions from section 10 that slices 1 to 5 did not already cover
- [x] 7. UX pass on every page using the UX check in section 7
- [x] 8. README, `.env.example`, final production deploy, end-to-end test run against the deployed URL

Deploy to production at the end of slice 2 and after every slice from then on. A working live link early matters more than a complete one late.

## 9. Deliverables

- A public GitHub repository with `.agent-logs/` committed in it
- The production URL on Vercel, open to a visitor who is not signed in to anything
- README with setup steps, a short architecture summary, and a "Product decisions" section that lists what was kept, cut and changed from Amazon, with one line of reasoning each
- `.env.example`
- A git history with at least one commit per slice

The walkthrough video is recorded by the candidate, not by the agent.

## 10. From the brief

### 10.1 What the brief asks for

- Rebuild amazon.com within a 24 hour window. The clock is tracked, not enforced.
- Use the product as a reference, not a blueprint. A pixel for pixel copy scores poorly. Show what was changed, what was cut and how it is better to use.
- Judged on speed, product judgement, and UX and UI.
  - Speed is how much working product exists in the time.
  - Product judgement is what was built first and what was left out.
  - UX and UI is whether the shipped product is good to use.

### 10.2 Agent capture

- Before any building, follow the 8x agent capture setup so prompts and responses are saved into the repository. The candidate pastes the setup instructions into the session.
- Do not start slice 1 until the capture test passes.
- Commit `.agent-logs/` with every slice commit. Never add it to `.gitignore`.

### 10.3 Hand-in

- A live link, deployed and open.
- A public repository with `.agent-logs/` in it.
- A walkthrough video of five minutes at most, camera on.

### 10.4 Product decisions

Store name: Stockroom

Cut from Amazon:

- Sponsored results and ads
- The sign-in wall. A visitor can browse, add to cart, order and see past orders without an account.
- Payment
- Third-party sellers, Prime upsells, recommendation carousels, wish lists
- Writing reviews. Ratings are shown, read only.

Changed to make it better to use:

- Search results contain only real matches, with sort and category filter in plain view.
- Search tolerates typos.
- The product page puts price, stock and "Add to cart" at the top, with nothing between them.
- Stock is honest. The product page shows "Only N left" when stock is low. If stock runs out while ordering, the checkout page names the item and the quantity still available.
- Cart changes show at once, before the server answers.
- Checkout is one page with a shipping form and a single "Place your order" button.
- Pages load from cache. Only the cart count, cart, checkout and orders render per visitor.
