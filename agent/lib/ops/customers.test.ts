import { describe, expect, test } from "bun:test";
import { formatDeliveryAddress } from "./customers.js";

describe("formatDeliveryAddress", () => {
  test("formats structured address without references", () => {
    const formatted = formatDeliveryAddress({
      street: "Av. Reforma 123",
      colony: "Centro",
      postalCode: "06000",
      city: "CDMX",
      zone: "Norte",
      address: null,
    });
    expect(formatted).toContain("Av. Reforma 123");
    expect(formatted).toContain("Col. Centro");
    expect(formatted).toContain("CDMX");
  });
});

describe("effective address resolution", () => {
  test("uses formattedAddress when references are empty", () => {
    const formattedAddress = formatDeliveryAddress({
      street: "Calle 1",
      colony: "Roma",
      city: "CDMX",
      address: null,
    });
    expect(formattedAddress.length).toBeGreaterThan(0);
  });
});
