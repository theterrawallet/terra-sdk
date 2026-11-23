import { PRODUCTS } from "../lib/products";
import { BuyButton } from "./buy-button";

export default function Page() {
  return (
    <>
      <h1>Merch</h1>
      <p className="muted">Pay in USDC or USDT with Terra Wallet or any wallet. Prices are in USD.</p>
      <ul className="grid">
        {PRODUCTS.map((p) => (
          <li key={p.id} className="card">
            <h2>{p.name}</h2>
            <p className="muted">{p.blurb}</p>
            <p className="price">${p.price}</p>
            <BuyButton productId={p.id} />
          </li>
        ))}
      </ul>
    </>
  );
}
