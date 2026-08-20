import { describe, expect, test } from "bun:test";
import { applyBidonLine, carriesBidon, type BidonProduct } from "./bidon.js";
import type { ResolvedOrderItem } from "./orders.js";

const BIDON: BidonProduct = {
  id: "bidon-id",
  name: "BIDON",
  unit: "bidón",
  price: 25,
  wholesalePrice: 25,
};

function item(partial: Partial<ResolvedOrderItem> = {}): ResolvedOrderItem {
  return {
    productId: "cloro-20l",
    productName: "CLORO 20 LITROS",
    unit: "litro",
    quantity: 2,
    unitPrice: 190,
    total: 380,
    notes: null,
    ...partial,
  };
}

describe("carriesBidon", () => {
  test("un liquido de 20 L lleva bidon", () => {
    expect(carriesBidon({ presentation: "20L", categoryName: "Líquidos", bidon: null })).toBe(true);
    expect(carriesBidon({ presentation: "20 L", categoryName: "liquidos", bidon: null })).toBe(true);
    expect(carriesBidon({ presentation: "20L", categoryName: "Limpieza a granel", bidon: null })).toBe(true);
  });

  test("los articulos de 20 L que no son liquidos NO llevan bidon", () => {
    // CESTO PAPELERO 20 LITROS, CUBETA 20 LITROS, PALANGANA 20 LITROS.
    expect(carriesBidon({ presentation: "20L", categoryName: "Plásticos", bidon: null })).toBe(false);
    expect(carriesBidon({ presentation: "20L", categoryName: "Jarciería", bidon: null })).toBe(false);
  });

  test("otras presentaciones no llevan bidon automatico (10 L se pregunta)", () => {
    expect(carriesBidon({ presentation: "10L", categoryName: "Líquidos", bidon: null })).toBe(false);
    expect(carriesBidon({ presentation: "1L", categoryName: "Líquidos", bidon: null })).toBe(false);
    expect(carriesBidon({ presentation: null, categoryName: "Líquidos", bidon: null })).toBe(false);
  });

  test("el override del catalogo (variants.bidon) manda sobre la regla", () => {
    // 10 L marcado a mano: sale en bidon de 20 L y se cobra automatico.
    expect(carriesBidon({ presentation: "10L", categoryName: "Líquidos", bidon: true })).toBe(true);
    // Producto sin presentacion pero marcado.
    expect(carriesBidon({ presentation: null, categoryName: "Líquidos", bidon: true })).toBe(true);
    // 20 L liquido con el override apagado no cobra bidon.
    expect(carriesBidon({ presentation: "20L", categoryName: "Líquidos", bidon: false })).toBe(false);
  });
});

describe("applyBidonLine", () => {
  test("agrega un bidon por cada envase de 20 L y lo suma al pedido", () => {
    const { items, bidonLine } = applyBidonLine([item()], 2, BIDON, "retail");
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ productId: "bidon-id", quantity: 2, total: 50 });
    expect(bidonLine).toEqual({ quantity: 2, unitPrice: 25, total: 50 });
  });

  test("sin envases de 20 L no agrega nada", () => {
    const { items, bidonLine } = applyBidonLine([item()], 0, BIDON, "retail");
    expect(items).toHaveLength(1);
    expect(bidonLine).toBeNull();
  });

  test("no duplica la linea si el pedido ya traia bidones (cotizacion -> pedido)", () => {
    const existing: ResolvedOrderItem = {
      productId: "bidon-id",
      productName: "BIDON",
      unit: "bidón",
      quantity: 2,
      unitPrice: 25,
      total: 50,
      notes: null,
    };
    const { items, bidonLine } = applyBidonLine([item(), existing], 2, BIDON, "retail");
    expect(items).toHaveLength(2);
    expect(bidonLine).toEqual({ quantity: 2, unitPrice: 25, total: 50 });
  });

  test("respeta bidones extra pedidos a mano (se queda con la cantidad mayor)", () => {
    const existing: ResolvedOrderItem = {
      productId: "bidon-id",
      productName: "BIDON",
      unit: "bidón",
      quantity: 5,
      unitPrice: 25,
      total: 125,
      notes: null,
    };
    const { bidonLine } = applyBidonLine([item(), existing], 2, BIDON, "retail");
    expect(bidonLine).toEqual({ quantity: 5, unitPrice: 25, total: 125 });
  });

  test("sin producto BIDON en el catalogo no rompe el pedido", () => {
    const { items, bidonLine } = applyBidonLine([item()], 2, null, "retail");
    expect(items).toHaveLength(1);
    expect(bidonLine).toBeNull();
  });
});

describe("applyBidonLine sin envases de 20 L", () => {
  test("un BIDON pedido a mano no dispara el aviso del chofer", () => {
    const manual: ResolvedOrderItem = {
      productId: "bidon-id",
      productName: "BIDON",
      unit: "bidón",
      quantity: 1,
      unitPrice: 25,
      total: 25,
      notes: null,
    };
    const { items, bidonLine } = applyBidonLine([manual], 0, BIDON, "retail");
    expect(items).toHaveLength(1);
    expect(bidonLine).toBeNull();
  });
});
