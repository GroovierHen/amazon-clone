/**
 * Products written for this project. The public sample dataset has 194 products
 * and SPEC.md 6.7 asks for at least 200, so these fill the thinner categories.
 * Their images are local placeholders in /public/seed.
 */
export type ExtraProduct = {
  title: string;
  description: string;
  category: string;
  price: number;
  rating: number;
  stock: number;
};

export const extraProducts: ExtraProduct[] = [
  {
    title: "Linen Throw Blanket",
    description:
      "A stonewashed linen throw that softens with every wash. Light enough for summer evenings and wide enough to cover a two-seat sofa.",
    category: "home-furniture",
    price: 54,
    rating: 4.6,
    stock: 38,
  },
  {
    title: "Adjustable Desk Lamp",
    description:
      "A matte steel desk lamp with a jointed arm and a warm, dimmable LED. The weighted base keeps it steady at full reach.",
    category: "home-furniture",
    price: 42.5,
    rating: 4.4,
    stock: 4,
  },
  {
    title: "Woven Storage Baskets, Set of 3",
    description:
      "Three nesting baskets woven from seagrass, with stitched handles. Sized for shelves, blankets and the pile by the front door.",
    category: "home-furniture",
    price: 36,
    rating: 4.3,
    stock: 61,
  },
  {
    title: "Ceramic Planter with Drainage Tray",
    description:
      "A glazed stoneware planter for pots up to 15 cm, with a drainage hole and a matching tray that catches the runoff.",
    category: "home-furniture",
    price: 24.9,
    rating: 4.7,
    stock: 27,
  },
  {
    title: "Bamboo Paddle Hairbrush",
    description:
      "A wide paddle brush with rounded bamboo pins that detangle without static. The cushion base flexes to follow the scalp.",
    category: "beauty",
    price: 13.5,
    rating: 4.5,
    stock: 84,
  },
  {
    title: "Unscented Hand Cream, 75 ml",
    description:
      "A fast-absorbing hand cream with shea butter and glycerin and no added fragrance. Leaves no film on screens or keyboards.",
    category: "beauty",
    price: 8.75,
    rating: 4.2,
    stock: 120,
  },
  {
    title: "Reusable Cotton Facial Rounds, Pack of 16",
    description:
      "Sixteen washable cotton rounds for removing makeup and applying toner, with a mesh laundry bag. Each one replaces hundreds of disposables.",
    category: "beauty",
    price: 11.2,
    rating: 4.1,
    stock: 2,
  },
  {
    title: "Portable Tyre Inflator",
    description:
      "A cordless tyre inflator with a digital gauge that stops at the pressure you set. Tops up a car tyre in about four minutes and fits in a glovebox.",
    category: "automotive",
    price: 59.99,
    rating: 4.5,
    stock: 19,
  },
  {
    title: "Microfibre Car Cloths, Pack of 6",
    description:
      "Six edgeless microfibre cloths for drying, polishing and glass. They hold eight times their weight in water and leave no lint.",
    category: "automotive",
    price: 14.99,
    rating: 4.6,
    stock: 150,
  },
  {
    title: "Dashboard Phone Mount",
    description:
      "A one-hand phone mount with a suction base for dashboards and windscreens. The arm extends and swivels, and the grip opens to fit large phones in cases.",
    category: "automotive",
    price: 18.5,
    rating: 4.0,
    stock: 73,
  },
  {
    title: "Jump Starter Power Pack",
    description:
      "A compact lithium jump starter for petrol engines up to 6 litres, with spark-proof clamps, a torch and a USB port for charging a phone.",
    category: "automotive",
    price: 89,
    rating: 4.7,
    stock: 0,
  },
  {
    title: "Non-Slip Yoga Mat, 6 mm",
    description:
      "A 6 mm natural rubber yoga mat with a textured surface that grips when wet. Comes with a carry strap and rolls flat without curling.",
    category: "sports-outdoors",
    price: 32,
    rating: 4.6,
    stock: 45,
  },
  {
    title: "Resistance Bands, Set of 5",
    description:
      "Five latex loop bands from light to extra heavy, colour coded by strength. Use them for warm-ups, strength work and physiotherapy exercises.",
    category: "sports-outdoors",
    price: 16.99,
    rating: 4.4,
    stock: 96,
  },
  {
    title: "Insulated Steel Water Bottle, 750 ml",
    description:
      "A double-walled stainless steel bottle that keeps drinks cold for a day or hot for twelve hours. The lid is leakproof and the mouth fits ice cubes.",
    category: "sports-outdoors",
    price: 27.5,
    rating: 4.8,
    stock: 5,
  },
];
