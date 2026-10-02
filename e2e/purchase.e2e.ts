import { expect, test } from "@playwright/test";

// The whole purchase, as a visitor with no account (SPEC.md section 7):
// search, open a product, add to cart, place the order, see it in order
// history, and confirm stock dropped by the ordered quantity.
//
// It places a real order for two units of a product that is seeded with 150.

const QUANTITY = 2;

test("search, add to cart, place an order, and see stock drop", async ({ page }) => {
  // Search from the home page.
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search products" }).fill("microfibre cloths");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("microfibre cloths");

  // Open the product and read how many are in stock.
  await page.getByRole("link", { name: "Microfibre Car Cloths, Pack of 6" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Microfibre Car Cloths, Pack of 6" })).toBeVisible();
  const productUrl = page.url();
  const stockText = await page.getByText(/^\d[\d,]* in stock$/).innerText();
  const stockBefore = Number(stockText.replace(/\D/g, ""));
  expect(stockBefore).toBeGreaterThanOrEqual(QUANTITY);

  // Add to cart. The header count follows.
  const cartLink = page.getByRole("banner").getByRole("link", { name: /^Cart/ });
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to your cart.")).toBeVisible();
  await expect(cartLink).toContainText("1 item");

  // Raise the quantity in the cart.
  await page.getByRole("link", { name: "View cart" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Cart" })).toBeVisible();
  await page.getByRole("button", { name: "Increase quantity of Microfibre Car Cloths, Pack of 6" }).click();
  await expect(cartLink).toContainText(`${QUANTITY} items`);
  await expect(page.getByLabel(`Quantity ${QUANTITY}`)).toBeVisible();

  // Check out on one page.
  await page.getByRole("link", { name: "Go to checkout" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
  await page.getByLabel("Full name").fill("Ada Lovelace");
  await page.getByLabel("Street address").fill("12 Analytical Row");
  await page.getByLabel("Town or city").fill("London");
  await page.getByLabel("Postcode").fill("N1 9GU");
  await page.getByRole("button", { name: "Place your order" }).click();

  // The confirmation is the order page.
  await expect(page.getByText("Your order is placed.")).toBeVisible();
  await expect(page).toHaveURL(/\/orders\/\d+/);
  const orderId = new URL(page.url()).pathname.split("/").pop();
  await expect(page.getByRole("heading", { level: 1, name: `Order ${orderId}` })).toBeVisible();
  // Scoped to the order: the checkout page stays mounted, hidden, after the redirect.
  const order = page.getByRole("article");
  await expect(order.getByRole("link", { name: "Microfibre Car Cloths, Pack of 6" })).toBeVisible();
  await expect(order.getByText(`${QUANTITY} × $14.99`)).toBeVisible();
  await expect(order.getByText("Ada Lovelace")).toBeVisible();
  await expect(cartLink).toContainText("0 items");

  // The order is in the order history.
  await page.getByRole("banner").getByRole("link", { name: "Orders" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`Order ${orderId}\\b`) })).toBeVisible();

  // Stock on the product page dropped by exactly the ordered quantity.
  await page.goto(productUrl);
  await expect(page.getByText(/^\d[\d,]* in stock$/)).toHaveText(`${stockBefore - QUANTITY} in stock`);
});

test("checkout names missing shipping details instead of placing the order", async ({ page }) => {
  await page.goto("/product/microfibre-car-cloths-pack-of-6");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to your cart.")).toBeVisible();
  // Follow the links a visitor would use. The confirmation shows before the
  // server has answered, so jumping to a new URL here could cancel the add.
  await page.getByRole("link", { name: "View cart" }).click();
  await page.getByRole("link", { name: "Go to checkout" }).click();
  await page.getByLabel("Full name").fill("Ada Lovelace");
  await page.getByRole("button", { name: "Place your order" }).click();

  await expect(page.getByText("Enter a street address.")).toBeVisible();
  await expect(page.getByText("Enter a postcode.")).toBeVisible();
  await expect(page.getByLabel("Full name")).toHaveValue("Ada Lovelace");
  await expect(page).toHaveURL(/\/checkout$/);
});
