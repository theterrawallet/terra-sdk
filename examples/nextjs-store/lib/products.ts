/** The catalogue lives on the server: prices are never taken from the browser. */
export interface Product {
  id: string;
  name: string;
  blurb: string;
  /** Decimal string in USD. */
  price: string;
}

export const PRODUCTS: readonly Product[] = [
  { id: "tee", name: "Terra tee", blurb: "Soft cotton, midnight blue.", price: "24.00" },
  { id: "cap", name: "Terra cap", blurb: "Embroidered shield logo.", price: "18.00" },
  { id: "hoodie", name: "Terra hoodie", blurb: "Heavyweight fleece.", price: "49.00" },
];

export const findProduct = (id: unknown) => PRODUCTS.find((p) => p.id === id);
