import { describe, expect, test } from "bun:test";
import { requiresHumanPayment } from "./payment-policy.js";

describe("requiresHumanPayment", () => {
  test("transferencia obliga a derivar", () => {
    expect(requiresHumanPayment("transferencia")).toBe(true);
    expect(requiresHumanPayment(" Transferencia ")).toBe(true);
  });

  test("efectivo y ausencia de forma de pago no derivan", () => {
    expect(requiresHumanPayment("efectivo")).toBe(false);
    expect(requiresHumanPayment(null)).toBe(false);
    expect(requiresHumanPayment(undefined)).toBe(false);
    expect(requiresHumanPayment("")).toBe(false);
  });
});
