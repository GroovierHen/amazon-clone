import { formatCount, stockLevel } from "@/lib/format";

/**
 * The stock line on a product: plain when there is plenty, a yellow shelf tag
 * when it is nearly gone. `exact` shows the real count, as the product page does.
 */
export function StockNote({
  stock,
  exact = false,
  className = "",
}: {
  stock: number;
  exact?: boolean;
  className?: string;
}) {
  const level = stockLevel(stock);
  if (level === "out") {
    return <p className={`font-medium text-muted ${className}`}>Out of stock</p>;
  }
  if (level === "low") {
    return (
      <p className={className}>
        <span className="inline-block rounded-sm bg-tag px-1.5 py-0.5 font-semibold text-ink">Only {stock} left</span>
      </p>
    );
  }
  return <p className={`text-pine ${className}`}>{exact ? `${formatCount(stock)} in stock` : "In stock"}</p>;
}
