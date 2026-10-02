import Image from "next/image";
import Link from "next/link";
import { ProductGrid } from "@/components/product-card";
import { getCategories, getProductList } from "@/lib/catalog";
import { formatCount, searchHref } from "@/lib/format";

export default async function Home() {
  const [categories, newest, topRated] = await Promise.all([
    getCategories(),
    getProductList({ sort: "newest", limit: 6 }),
    getProductList({ sort: "rating", limit: 6 }),
  ]);
  const productCount = categories.reduce((sum, category) => sum + category.productCount, 0);

  return (
    <div className="container-page">
      <section aria-labelledby="aisles-heading" className="pt-10 md:pt-14">
        <h1 id="aisles-heading" className="type-wide max-w-3xl text-3xl font-extrabold leading-tight md:text-5xl">
          Every count you see here is what is on the shelf.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">
          {formatCount(productCount)} products in {categories.length} aisles. No ads, no account, and no surprises at
          checkout about what is left.
        </p>

        <ul className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {categories.map((category) => (
            <li key={category.slug}>
              <Link
                href={searchHref({ category: category.slug })}
                className="group flex h-full items-center gap-3 rounded-md bg-shelf p-3 hover:bg-line/60 md:gap-4 md:p-4"
              >
                <span className="relative block size-14 shrink-0 md:size-20">
                  {category.imageUrl ? (
                    <Image
                      src={category.imageUrl}
                      alt=""
                      fill
                      sizes="(min-width: 768px) 80px, 56px"
                      className="object-contain"
                    />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold leading-tight group-hover:underline md:text-lg">
                    {category.name}
                  </span>
                  <span className="type-narrow mt-0.5 block text-sm text-muted">
                    {formatCount(category.productCount)} products
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <ProductRow
        id="new-heading"
        title="New on the shelf"
        linkLabel="See all new arrivals"
        href={searchHref({ sort: "newest" })}
      >
        <ProductGrid products={newest.items} />
      </ProductRow>

      <ProductRow
        id="rated-heading"
        title="Best rated"
        linkLabel="See all top rated"
        href={searchHref({ sort: "rating" })}
      >
        <ProductGrid products={topRated.items} />
      </ProductRow>
    </div>
  );
}

function ProductRow({
  id,
  title,
  linkLabel,
  href,
  children,
}: {
  id: string;
  title: string;
  linkLabel: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-14">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id={id} className="type-wide text-2xl font-bold">
          {title}
        </h2>
        <Link href={href} className="font-medium text-pine underline underline-offset-4 hover:text-pine-deep">
          {linkLabel}
        </Link>
      </div>
      {children}
    </section>
  );
}
