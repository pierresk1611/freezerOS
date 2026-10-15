import { expect, it } from "vitest";
import {
  cartDifference,
  rohlikProvider,
  rohlikCapabilities,
} from "../src/lib/rohlik";
it("unsupported connection exposes no live writer or OAuth success", () => {
  expect(rohlikProvider()).toBeNull();
  expect(rohlikCapabilities.connected).toBe(false);
  expect(rohlikCapabilities.toolsListVerified).toBe(false);
});
it("cart preview preserves personal products and repeat preview adds nothing", () => {
  const cart = {
    revision: "1",
    items: [
      { productId: "gel", quantity: 1 },
      { productId: "wine", quantity: 2 },
      { productId: "bananas", quantity: 4 },
    ],
  };
  const desired = [
    { productId: "meat", quantity: 2 },
    { productId: "rice", quantity: 1 },
  ];
  expect(cartDifference(cart, desired).map((x) => x.add)).toEqual([2, 1]);
  expect(cart.items).toHaveLength(3);
  expect(
    cartDifference(
      { ...cart, items: [...cart.items, ...desired] },
      desired,
    ).map((x) => x.add),
  ).toEqual([0, 0]);
});
it("does not remove a larger existing personal quantity", () => {
  expect(
    cartDifference(
      { revision: "1", items: [{ productId: "rice", quantity: 3 }] },
      [{ productId: "rice", quantity: 1 }],
    )[0].add,
  ).toBe(0);
});
