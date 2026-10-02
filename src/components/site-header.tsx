import Link from "next/link";
import { Suspense } from "react";
import { getPool } from "@/db/client";
import { getCartCount } from "@/lib/cart";
import { getCategories } from "@/lib/catalog";
import { searchHref } from "@/lib/format";
import { getVisitorId } from "@/lib/visitor";
import { CartCountBadge } from "./cart-provider";
import { SearchBox } from "./search-box";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-paper">
      <div className="container-page grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-3 py-3 md:grid-cols-[auto_1fr_auto]">
        <Link href="/" className="type-wide col-start-1 row-start-1 justify-self-start text-2xl font-extrabold text-pine">
          Stockroom
        </Link>

        <div className="col-span-2 col-start-1 row-start-2 w-full md:col-span-1 md:col-start-2 md:row-start-1 md:max-w-2xl">
          <SearchBox />
        </div>

        <nav aria-label="Your account" className="col-start-2 row-start-1 flex items-center gap-1 md:col-start-3">
          <Link href="/orders" className="rounded-md px-3 py-2 font-medium hover:bg-shelf">
            Orders
          </Link>
          <Link href="/cart" className="flex items-center rounded-md px-3 py-2 font-medium hover:bg-shelf">
            Cart
            {/* The count is per visitor, so it streams in and is never cached. */}
            <Suspense fallback={<span className="ml-1.5 inline-block min-w-6" />}>
              <CartCount />
            </Suspense>
          </Link>
        </nav>
      </div>

      <AisleNav />
    </header>
  );
}

async function CartCount() {
  const visitorId = await getVisitorId();
  const count = visitorId ? await getCartCount(getPool(), visitorId) : 0;
  return <CartCountBadge count={count} />;
}

async function AisleNav() {
  const categories = await getCategories();

  return (
    <nav aria-label="Aisles" className="border-t border-line bg-shelf">
      <ul className="container-page scroll-row gap-1 py-1">
        {categories.map((category) => (
          <li key={category.slug} className="shrink-0">
            <Link
              href={searchHref({ category: category.slug })}
              className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-paper"
            >
              {category.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
