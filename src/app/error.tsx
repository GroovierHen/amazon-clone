"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container-page py-16">
      <h1 className="type-wide text-2xl font-bold md:text-3xl">This page did not load.</h1>
      <p className="mt-3 max-w-xl text-muted">
        The store could not reach its stock records. Nothing in your cart has changed. Try again, and if it keeps
        failing, come back in a few minutes.
      </p>
      <p className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-pine px-4 py-2.5 font-semibold text-white hover:bg-pine-deep"
        >
          Try again
        </button>
        <Link href="/" className="rounded-md border border-ink px-4 py-2.5 font-semibold hover:bg-ink hover:text-white">
          Go to the home page
        </Link>
      </p>
    </div>
  );
}
