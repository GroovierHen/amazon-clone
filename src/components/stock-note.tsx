import { stockLevel } from "@/lib/format";

/** The stock line on a product: plain when there is plenty, a yellow shelf tag when it is nearly gone. */
export function StockNote({ stock, className = "" }: { stock: number; className?: string }) {
  const level = stockLevel(stock);
  if (level === "out") {
    return <p className={`text-sm font-medium text-muted ${className}`}>Out of stock</p>;
  }
  if (level === "low") {
    return (
      <p className={`text-sm ${className}`}>
        <span className="inline-block rounded-sm bg-tag px-1.5 py-0.5 font-semibold text-ink">Only {stock} left</span>
      </p>
    );
  }
  return <p className={`text-sm text-pine ${className}`}>In stock</p>;
}
