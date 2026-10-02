import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-shelf">
      <div className="container-page flex flex-col gap-3 py-8 text-sm text-muted md:flex-row md:items-center md:justify-between">
        <p className="max-w-xl">
          Stockroom is a demo store. Nothing is charged and nothing is shipped. Stock counts are real: placing an
          order takes items off the shelf.
        </p>
        <nav aria-label="Footer" className="flex gap-4 font-medium text-ink">
          <Link href="/search" className="hover:underline">
            All products
          </Link>
          <Link href="/orders" className="hover:underline">
            Orders
          </Link>
          <Link href="/cart" className="hover:underline">
            Cart
          </Link>
        </nav>
      </div>
    </footer>
  );
}
