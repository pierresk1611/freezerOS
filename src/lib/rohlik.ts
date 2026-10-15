/** No token/client registration or live tool schema has been verified for FREEZER OS.
 * Documentation supplied by the user describes OAuth + shopping capabilities.
 * Runtime remains deliberately unavailable until discovery and authorization pass.
 */
export const rohlikCapabilities = {
  endpoint: "https://mcp.rohlik.cz/mcp",
  documentation: "https://www.rohlik.cz/en-CZ/mcp-docs",
  documentedOAuth: true,
  documentedTransport: "http",
  transportVerified: false,
  clientRegistrationVerified: false,
  toolsListVerified: false,
  productSearchVerified: false,
  cartReadVerified: false,
  cartWriteVerified: false,
  connected: false,
} as const;
export interface RohlikProduct {
  id: string;
  name: string;
  priceMinor: number | null;
  available: boolean | null;
  packQuantity: number | null;
  unit: "g" | "ml" | "ks" | null;
}
export interface RohlikCart {
  revision: string;
  items: { productId: string; quantity: number }[];
}
export interface RohlikProvider {
  search(query: string): Promise<RohlikProduct[]>;
  readCart(): Promise<RohlikCart>;
  /** Provider must compare expected cart revision before a confirmed mutation. */
  addConfirmed(
    productId: string,
    quantity: number,
    expectedRevision: string,
  ): Promise<void>;
}
export function rohlikProvider(): RohlikProvider | null {
  return null;
}
// Conservative diff: preserve unrelated products and add only a shortfall.
// This is a pure preview; it never authorizes or executes a remote write.
export function cartDifference(
  cart: RohlikCart,
  desired: { productId: string; quantity: number }[],
) {
  const totals = new Map<string, number>();
  for (const d of desired) {
    if (!Number.isSafeInteger(d.quantity) || d.quantity < 0)
      throw Error("Neplatné množstvo produktu.");
    totals.set(d.productId, (totals.get(d.productId) ?? 0) + d.quantity);
  }
  return [...totals]
    .map(([productId, quantity]) => ({
      productId,
      existing: cart.items
        .filter((i) => i.productId === productId)
        .reduce((s, i) => s + i.quantity, 0),
      desired: quantity,
    }))
    .map((d) => ({ ...d, add: Math.max(0, d.desired - d.existing) }));
}
