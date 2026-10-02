import Image from "next/image";
import Link from "next/link";
import { formatPrice } from "@/lib/format";
import type { ProductCard as Product } from "@/lib/products";
import { Rating } from "./rating";
import { StockNote } from "./stock-note";

/** Width the card image is shown at, for next/image's `sizes` (SPEC.md 6.6). */
const CARD_SIZES = "(min-width: 1280px) 190px, (min-width: 1024px) 22vw, (min-width: 640px) 30vw, 46vw";

export function ProductCard({ product }: { product: Product }) {
  return (
    <li className="group relative flex flex-col">
      <div className="relative aspect-square overflow-hidden rounded-md bg-shelf">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt=""
            fill
            sizes={CARD_SIZES}
            className="object-contain p-3 transition-transform duration-200 group-hover:scale-[1.03]"
          />
        ) : null}
      </div>
      <h3 className="mt-3 line-clamp-2 text-[0.95rem] font-medium leading-snug">
        {/* The link covers the whole card, so the photo is clickable too. */}
        <Link href={`/product/${product.slug}`} className="after:absolute after:inset-0 group-hover:underline">
          {product.title}
        </Link>
      </h3>
      <Rating average={product.ratingAvg} count={product.ratingCount} className="mt-1" />
      <p className="type-narrow mt-1 text-2xl font-bold">{formatPrice(product.priceCents)}</p>
      <StockNote stock={product.stock} className="mt-1" />
    </li>
  );
}

export function ProductGrid({ products }: { products: Product[] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </ul>
  );
}

export function ProductGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <ul
      aria-hidden="true"
      className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
    >
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex flex-col">
          <div className="aspect-square animate-pulse rounded-md bg-shelf" />
          <div className="mt-3 h-4 w-11/12 animate-pulse rounded bg-shelf" />
          <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-shelf" />
          <div className="mt-3 h-6 w-1/3 animate-pulse rounded bg-shelf" />
        </li>
      ))}
    </ul>
  );
}
