import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProductGallery } from "@/components/product-gallery";
import { Rating } from "@/components/rating";
import { StockNote } from "@/components/stock-note";
import { getProductContent, getProductOffer, getProductSlugs } from "@/lib/catalog";
import { formatPrice, searchHref } from "@/lib/format";
import { splitDescription } from "@/lib/products";

type Params = Promise<{ slug: string }>;

/** Every product page is prerendered; unknown slugs get the shell and then a not-found message. */
export async function generateStaticParams() {
  const slugs = await getProductSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductContent(slug);
  if (!product) return { title: "Product not found" };
  return {
    title: product.title,
    description: splitDescription(product.description).paragraphs[0],
  };
}

export default function ProductPage({ params }: { params: Params }) {
  return (
    <div className="container-page pt-6 md:pt-8">
      <Suspense fallback={<ProductSkeleton />}>
        <ProductDetails params={params} />
      </Suspense>
    </div>
  );
}

async function ProductDetails({ params }: { params: Params }) {
  const { slug } = await params;
  const product = await getProductContent(slug);
  if (!product) notFound();
  const offer = await getProductOffer(product.id);
  if (!offer) notFound();

  const { paragraphs, facts } = splitDescription(product.description);

  return (
    <article>
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href={searchHref({ category: product.categorySlug })} className="underline underline-offset-4 hover:text-ink">
          {product.categoryName}
        </Link>
      </nav>

      <div className="mt-4 grid gap-8 md:grid-cols-2 md:gap-12">
        <ProductGallery images={product.imageUrls} title={product.title} />

        <div>
          <h1 className="type-wide text-2xl font-bold leading-tight md:text-4xl">{product.title}</h1>
          <Rating average={product.ratingAvg} count={product.ratingCount} className="mt-2 text-base" />

          {/* Price, stock and the button sit together with nothing between them (SPEC.md 10.4). */}
          <div className="mt-6 max-w-sm rounded-md border border-line p-5">
            <p className="type-narrow text-5xl font-bold leading-none">{formatPrice(offer.priceCents)}</p>
            <StockNote stock={offer.stock} exact className="mt-3 text-lg" />
          </div>

          <section aria-labelledby="about-heading" className="mt-8 max-w-prose">
            <h2 id="about-heading" className="text-lg font-semibold">
              About this product
            </h2>
            {paragraphs.map((paragraph) => (
              <p key={paragraph} className="mt-2 leading-relaxed">
                {paragraph}
              </p>
            ))}
            {facts.length > 0 ? (
              <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-line pt-4">
                {facts.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="font-medium text-muted">{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>
        </div>
      </div>
    </article>
  );
}

function ProductSkeleton() {
  return (
    <div role="status" aria-label="Loading product">
      <div className="h-5 w-24 animate-pulse rounded bg-shelf" />
      <div className="mt-4 grid gap-8 md:grid-cols-2 md:gap-12">
        <div className="aspect-square animate-pulse rounded-md bg-shelf" />
        <div>
          <div className="h-9 w-4/5 animate-pulse rounded bg-shelf" />
          <div className="mt-3 h-5 w-40 animate-pulse rounded bg-shelf" />
          <div className="mt-6 h-44 max-w-sm animate-pulse rounded-md bg-shelf" />
          <div className="mt-8 h-24 max-w-prose animate-pulse rounded bg-shelf" />
        </div>
      </div>
    </div>
  );
}
