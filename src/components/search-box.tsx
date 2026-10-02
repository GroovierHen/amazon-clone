import Form from "next/form";

export const SEARCH_INPUT_ID = "site-search";

/**
 * The header search. It is part of the static shell, so it does not know the
 * current query; the search page fills it in with <SearchQuerySync />.
 */
export function SearchBox() {
  return (
    <Form action="/search" role="search" className="flex w-full">
      <label htmlFor={SEARCH_INPUT_ID} className="sr-only">
        Search products
      </label>
      <input
        id={SEARCH_INPUT_ID}
        name="q"
        type="search"
        placeholder="Search products"
        autoComplete="off"
        enterKeyHint="search"
        className="h-11 min-w-0 flex-1 rounded-l-md border border-r-0 border-ink/40 bg-paper px-3 text-base placeholder:text-muted focus-visible:relative focus-visible:z-10"
      />
      <button
        type="submit"
        className="h-11 shrink-0 rounded-r-md bg-pine px-4 font-semibold text-white hover:bg-pine-deep focus-visible:relative focus-visible:z-10"
      >
        Search
      </button>
    </Form>
  );
}
