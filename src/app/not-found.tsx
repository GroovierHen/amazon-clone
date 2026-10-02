import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-page py-16">
      <h1 className="type-wide text-2xl font-bold md:text-3xl">There is nothing at this address.</h1>
      <p className="mt-3 max-w-xl text-muted">
        The link may be old, or the product may no longer be stocked. Search for it by name, or browse the aisles.
      </p>
      <p className="mt-6 flex flex-wrap gap-3">
        <Link href="/search" className="rounded-md bg-pine px-4 py-2.5 font-semibold text-white hover:bg-pine-deep">
          Browse all products
        </Link>
        <Link href="/" className="rounded-md border border-ink px-4 py-2.5 font-semibold hover:bg-ink hover:text-white">
          Go to the home page
        </Link>
      </p>
    </div>
  );
}
