const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const whole = new Intl.NumberFormat("en-US");

/** Money is stored as integer cents and only turned into text here. */
export function formatPrice(cents: number): string {
  return usd.format(cents / 100);
}

export function formatCount(n: number): string {
  return whole.format(n);
}

/** Stock at or below this number is shown as "Only N left". */
export const LOW_STOCK = 5;

export type StockLevel = "out" | "low" | "in";

export function stockLevel(stock: number): StockLevel {
  if (stock <= 0) return "out";
  return stock <= LOW_STOCK ? "low" : "in";
}

type SearchHrefParams = {
  q?: string;
  category?: string;
  sort?: string;
  after?: string | null;
  before?: string | null;
};

/** Builds a /search link, leaving out anything empty. */
export function searchHref(params: SearchHrefParams): string {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.category) query.set("category", params.category);
  if (params.sort) query.set("sort", params.sort);
  if (params.after) query.set("after", params.after);
  else if (params.before) query.set("before", params.before);
  const text = query.toString();
  return text ? `/search?${text}` : "/search";
}

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

/** Dates are shown in UTC and say so, because the server does not know the visitor's time zone. */
export function formatDate(iso: string): string {
  return `${dateTime.format(new Date(iso))} UTC`;
}
