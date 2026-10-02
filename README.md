# Stockroom

A general store built in a day for a hiring assessment. The brief was to rebuild amazon.com using
it as a reference, not a blueprint. Stockroom keeps Amazon's flow (browse, search, product, cart,
checkout, orders) and changes what gets in a shopper's way.

One Next.js app and one Postgres database. No accounts, no payment, no ads.

- Live site: https://stockroom-store.vercel.app
- Repository: https://github.com/GroovierHen/stockroom
- How it was built: every prompt and final response is in [`.agent-logs/`](.agent-logs), and
  [`CAPTURE-TEST.md`](CAPTURE-TEST.md) shows the capture working.

## Product decisions

### Kept from Amazon

| What | Why |
|---|---|
| The flow: browse, search, product page, cart, checkout, order history | Shoppers already know it, so there is nothing to learn. |
| A search box at the top of every page | Search is how most people start. |
| Category navigation under the header | It answers "what do you sell" without a click. |
| Star ratings with a count on every product | They are the fastest signal of quality. |
| Order history with a page per order | People check what they bought and where it is going. |

### Cut

| What | Why |
|---|---|
| Sponsored results and ads | They put products the shopper did not ask for above the ones they did. |
| The sign-in wall | A visitor can browse, add to cart, order and see past orders without an account. A cookie identifies the browser. |
| Payment | Out of scope for the assessment. Checkout stops at "Place your order" and says nothing is charged. |
| Third-party sellers | One seller means one price and one stock count per product. |
| Prime upsells | They interrupt the purchase to sell something else. |
| Recommendation carousels | They push the product's own details down the page. |
| Wish lists | They need accounts, and the cart already holds things for later. |
| Writing reviews | Ratings are shown read only. Collecting reviews needs accounts and moderation. |
| Numbered result pages | Next and Previous are enough, and they stay correct while the catalog changes. |

### Changed

| What | Why it is better to use |
|---|---|
| Search results contain only real matches | Nothing is padded with loosely related products. A product is listed because its name or description matches. |
| Sort and aisle filter sit above the results, always visible | No sidebar of 40 filters, and nothing hidden behind a menu on a phone. |
| Search tolerates typos | "iphne" finds iPhones. The page says when it is showing close matches instead of exact ones. |
| Price, stock and "Add to cart" are one box at the top of the product page | Those three answer "can I buy this and for how much". Nothing sits between them. |
| Stock is the real count | The product page shows the number on the shelf, and "Only N left" at five or fewer. |
| Running out of stock is explained, not just refused | If stock runs out while ordering, checkout names the item, says how many are left and offers "Change to N" as one click. |
| Cart changes show at once | The header count and the cart lines update on click, before the server answers. |
| Checkout is one page | A shipping form, the order, and a single "Place your order" button. |
| Pages load from cache | Only the cart count, cart, checkout and orders are rendered per visitor. Everything else is prerendered. |
| Its own name, colours and type | Stockroom is green and white, set in one typeface (Archivo) at three widths. It is not a copy of Amazon's look. |

## Setup

You need [Bun](https://bun.sh) 1.x, Node 20 or newer (Playwright's test runner needs Node), and a
Postgres database. The project is set up for Neon through the Vercel Marketplace.

```sh
bun install
vercel link                         # once, to connect the folder to the Vercel project
vercel env pull                     # writes the database variables to .env.local
bun run db:migrate                  # creates the tables
bun run db:seed                     # loads 208 products in 8 categories
bun run dev                         # http://localhost:3000
```

Without Vercel, copy `.env.example` to `.env.local` and fill in the two connection strings.

### Commands

| Command | What it does |
|---|---|
| `bun run dev` | Starts the app |
| `bun run build` | Builds for production |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | ESLint |
| `bun test` | Unit and integration tests, against a real Postgres in the `test` schema |
| `bun run test:e2e` | Playwright: builds, starts the app and runs the whole purchase |
| `bun run db:migrate` | Applies the SQL files in `drizzle/` |
| `bun run db:seed` | Loads the catalog. Safe to run again; it also resets stock |

`bun test` drops and rebuilds a schema named `test` on every run. It never touches the schema
the app reads. `bun run test:e2e` places a real order in the app's database, for two units of a
product seeded with 150. Set `E2E_BASE_URL` to run it against a deployed site.

Run `bunx playwright install chromium` once before the first end-to-end run.

The tests talk to the real database, so `bun test` takes a few minutes when Postgres is on
another continent and a few seconds when it is local.

### Deploying

Vercel builds and deploys every push to `main`. The Neon database is connected through the
Vercel Marketplace, which supplies `DATABASE_URL` and `DATABASE_URL_UNPOOLED` to the build and
to the running app. Run `bun run db:migrate` and `bun run db:seed` against the database before
the first deploy: the build prerenders pages from it.

## Architecture

```
src/app/            pages and Server Actions (App Router)
src/components/     UI, server components unless they need the browser
src/lib/            queries and rules: products, cart, orders, cached reads
src/db/             Postgres pool, Drizzle schema, migrate and seed
drizzle/            SQL migrations, the source of truth for the schema
seed/               the catalog: a public sample dataset plus 14 products written here
tests/              bun tests against Postgres
e2e/                the Playwright purchase test
.agent-logs/        every prompt and final response from the build, captured by a hook
```

- **Next.js 16 with Cache Components.** Each page is a static shell. Cached reads (`use cache`)
  are prerendered into it. Anything per visitor reads the cookie inside `<Suspense>` and streams in.
- **Caching.** Product lists carry the tag `products` and the tag of every product on the page.
  Product content (title, description, images) is cached for days under `product:{id}`. Price
  and stock use the same tag with a lifetime of minutes. Placing an order invalidates the tag of
  every product in it. The cart, cart count, checkout and orders are never cached.
- **Pagination is keyset only.** A cursor is the sort value and id of the row at the edge of the
  page, base64url encoded. `after` loads the next page and `before` the previous one. `OFFSET` is
  never used, so pages stay correct while rows are added, and cost the same at any depth.
- **Search.** `websearch_to_tsquery` over a stored `tsvector` (title weighted above description),
  ranked with `ts_rank`. A name that contains the query text also matches. If nothing matches,
  the query falls back to trigram word similarity on the title.
- **Placing an order is one transaction.** Lock the cart, lock the product rows with
  `SELECT ... FOR UPDATE` in ascending id order, check every quantity against stock, decrement,
  insert the order with title and price copied from the product, delete the cart items, commit.
  The fixed lock order means two carts that share products cannot deadlock. If anything is
  short, the transaction rolls back and returns the short items. This is the only code that
  changes stock.
- **Money is integer cents** in the database and in code. It becomes text only in the UI.
- **No accounts.** An httpOnly `visitor_id` cookie is created on the first add to cart. The cart
  and orders belong to that id.

## Trade-offs

- **Orders belong to a browser, not a person.** Clearing cookies loses the order history. That
  is the cost of having no sign-in.
- **The catalog is sample data.** 194 products come from the [DummyJSON](https://dummyjson.com)
  sample dataset, with photos loaded from its CDN through `next/image`. 14 more were written for
  this project to reach 200, and use local placeholder images.
- **Typo tolerance only applies when exact search finds nothing.** A query with one misspelt
  word and one correct word can return the exact matches for the correct word only.
- **Price and stock can be up to a minute stale on cached pages.** Checkout and the cart always
  read them fresh, and the order transaction is the final check.
- **The cart allows any quantity up to 99 through the API.** The cart page stops the stepper at
  the stock level, and the order transaction refuses what is not there.
- **Bun runtime.** The scripts run Next.js under Bun (`bun --bun`). The Next.js docs say Cache
  Components is only guaranteed on Node. Under Bun the build output is identical to Node's, but
  `next start` logs "unhandledRejection: AbortError" when a browser cancels a request. The app
  keeps serving.

## Out of scope

Payment of any kind. Login and accounts. Seller pages, admin pages, writing reviews,
recommendations, wish lists and emails. Redis, Elasticsearch, message queues and microservices.

## Checks

`bun run typecheck`, `bun run lint`, `bun run build` and `bun test` pass at every slice commit.
The tests cover:

- **Keyset pagination**: walking forward returns every product once, walking backward returns
  the same pages, and products with equal sort values are neither skipped nor repeated, for
  every sort order.
- **Search**: full-text match, ranking order, the trigram fallback.
- **Cart**: add, change quantity, remove.
- **Order transaction**: the success path, and the short-stock path leaving stock and cart unchanged.
- **Concurrency**: ten carts place an order for the last unit at once. Exactly one succeeds and
  stock ends at 0.
- **End to end**: search, open a product, add to cart, place the order, see it in order history,
  and confirm stock dropped by the ordered quantity.
