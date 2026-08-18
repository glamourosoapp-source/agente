import { describe, expect, it, afterEach } from "bun:test";
import { isEffectivelyAvailable } from "./products.js";

const original = process.env.GLAM_ENFORCE_STOCK;

afterEach(() => {
  if (original === undefined) delete process.env.GLAM_ENFORCE_STOCK;
  else process.env.GLAM_ENFORCE_STOCK = original;
});

describe("isEffectivelyAvailable", () => {
  it("producto ilimitado sigue disponible con stock 0 y enforcement prendido", () => {
    process.env.GLAM_ENFORCE_STOCK = "true";
    expect(isEffectivelyAvailable({ isAvailable: true, stock: 0, unlimitedStock: true })).toBe(true);
  });

  it("producto con inventario y enforcement prendido se agota en stock 0", () => {
    process.env.GLAM_ENFORCE_STOCK = "true";
    expect(isEffectivelyAvailable({ isAvailable: true, stock: 0, unlimitedStock: false })).toBe(false);
    expect(isEffectivelyAvailable({ isAvailable: true, stock: 5, unlimitedStock: false })).toBe(true);
  });

  it("sin enforcement global, stock 0 no agota a nadie", () => {
    process.env.GLAM_ENFORCE_STOCK = "false";
    expect(isEffectivelyAvailable({ isAvailable: true, stock: 0, unlimitedStock: false })).toBe(true);
  });

  it("is_available=false manda por encima de la bandera de ilimitado", () => {
    expect(isEffectivelyAvailable({ isAvailable: false, stock: 99, unlimitedStock: true })).toBe(false);
  });

  it("sin la bandera (fila vieja) se asume ilimitado", () => {
    process.env.GLAM_ENFORCE_STOCK = "true";
    expect(isEffectivelyAvailable({ isAvailable: true, stock: 0 })).toBe(true);
  });
});
