/**
 * The shape of a cart and the sums over it. There is no database code here, so
 * client components can import it without pulling the query layer into the browser.
 */

/** Upper bound on one line, so a cart cannot hold absurd numbers. */
export const MAX_LINE_QUANTITY = 99;

export type CartLine = {
  productId: number;
  slug: string;
  title: string;
  imageUrl: string | null;
  /** The product's price right now. It is fixed only when the order is placed. */
  priceCents: number;
  stock: number;
  quantity: number;
};

export type Cart = {
  lines: CartLine[];
  count: number;
  subtotalCents: number;
};

export function summarize(lines: CartLine[]): Cart {
  return {
    lines,
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalCents: lines.reduce((sum, line) => sum + line.quantity * line.priceCents, 0),
  };
}
