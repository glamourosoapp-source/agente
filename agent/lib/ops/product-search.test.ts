import { describe, expect, test } from "bun:test";
import {
  buildLikePatterns,
  combineScores,
  diversifyByGroup,
  extractPresentation,
  extractProductGroupKey,
  normalizeText,
  scoreProduct,
  stemToken,
  tokenizeQuery,
  tokensMatch,
  type ScorableProduct,
} from "./product-search.js";

// Mini catalogo representativo del Excel real (lineas con presentaciones).
const CATALOG: ScorableProduct[] = [
  {
    name: "BICARBONATO DE SODIO 1 KILO",
    description: null,
    sku: "BIC-001",
    isAvailable: true,
    stock: 50,
  },
  {
    name: "DETERCLORO 1 LITRO",
    description: "Detergente liquido con cloro para ropa blanca",
    sku: "DET-001",
    isAvailable: true,
    stock: 100,
  },
  {
    name: "DETERCLORO 4 LITROS",
    description: "Detergente liquido con cloro para ropa blanca",
    sku: "DET-004",
    isAvailable: true,
    stock: 80,
  },
  {
    name: "DETERCLORO 10 LITROS",
    description: "Detergente liquido con cloro para ropa blanca",
    sku: "DET-010",
    isAvailable: true,
    stock: 30,
  },
  {
    name: "MAX COLOR 4 LITROS",
    description: "Detergente liquido para prendas de colores",
    sku: "MAX-C04",
    isAvailable: true,
    stock: 40,
  },
  {
    name: "MAX NEGRO 4 LITROS",
    description: "Detergente liquido para ropa negra",
    sku: "MAX-N04",
    isAvailable: true,
    stock: 40,
  },
  {
    name: "ALMOROL 1 LITRO",
    description: "Abrillantador para interiores de auto",
    sku: "ALM-001",
    isAvailable: true,
    stock: 20,
  },
];

function rank(query: string, products: ScorableProduct[] = CATALOG): string[] {
  const queryNorm = normalizeText(query);
  const tokens = tokenizeQuery(query);
  return products
    .map((p) => ({ p, score: scoreProduct(queryNorm, tokens, p) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .map((x) => x.p.name);
}

describe("normalizeText", () => {
  test("lowercase, sin acentos, sin signos", () => {
    expect(normalizeText("Jabón LÍQUIDO ¿para trastes?")).toBe("jabon liquido para trastes");
  });
});

describe("stemToken", () => {
  test("singulariza plurales comunes", () => {
    expect(stemToken("colores")).toBe("color");
    expect(stemToken("galones")).toBe("galon");
    expect(stemToken("detergentes")).toBe("detergente");
    expect(stemToken("guantes")).toBe("guante");
    expect(stemToken("prendas")).toBe("prenda");
  });
  test("no toca palabras cortas ni singulares", () => {
    expect(stemToken("gas")).toBe("gas");
    expect(stemToken("color")).toBe("color");
  });
});

describe("tokenizeQuery", () => {
  test("quita stopwords y singulariza", () => {
    expect(tokenizeQuery("detergente para ropa de color")).toEqual([
      "detergente",
      "ropa",
      "color",
    ]);
  });
  test("tolera acentos y mayusculas", () => {
    expect(tokenizeQuery("Jabón Líquido")).toEqual(["jabon", "liquido"]);
  });
  test("conserva tokens cortos con digito (presentaciones)", () => {
    expect(tokenizeQuery("detercloro 4l")).toContain("4l");
  });
  test("query de puras stopwords queda vacia", () => {
    expect(tokenizeQuery("quiero algo para la de")).toEqual([]);
  });
});

describe("tokensMatch / buildLikePatterns", () => {
  test("tolera genero en adjetivos", () => {
    expect(tokensMatch("negra", "negro")).toBe(true);
    expect(tokensMatch("blanca", "blanco")).toBe(true);
    expect(tokensMatch("ropa", "rope")).toBe(false);
  });
  test("sinonimo ropa/prenda en ambas direcciones", () => {
    expect(tokensMatch("ropa", "prenda")).toBe(true);
    expect(tokensMatch("prenda", "ropa")).toBe(true);
  });
  test("patrones SQL incluyen sinonimos y recorte de genero", () => {
    const patterns = buildLikePatterns(["ropa", "negra"]);
    expect(patterns).toContain("%ropa%");
    expect(patterns).toContain("%prend%"); // cubre prenda/prendas
    expect(patterns).toContain("%negr%"); // cubre negro/negra
  });
});

// Fixture con nombres y descripciones REALES del catalogo (Productos.xlsx),
// que es donde la busqueda literal fallaba: el cliente dice "ropa", las
// descripciones dicen "prendas".
const REAL_CATALOG: ScorableProduct[] = [
  {
    name: "CLORO ROPA COLOR 1 LITRO",
    description:
      "Cloro especializado para ropa de color, que ayuda a blanquear y mantener la intensidad de los colores sin dañarlos, presentación 1 litro.",
    sku: null,
    isAvailable: true,
    stock: 10,
  },
  {
    name: "DETERGENTE PARA ROPA DE BEBE 1 LITRO",
    description:
      "Detergente para Ropa bebé, diseñado para limpiar a fondo y cuidar tus prendas, dejándolas suaves, frescas y con un aroma agradable, presentación 1 litro.",
    sku: null,
    isAvailable: true,
    stock: 10,
  },
  {
    name: "MAX BLANCO 1 LITRO",
    description:
      "Detergente potente para ropa blanca, que ayuda a mantener las prendas brillantes y limpias sin dañar las fibras, presentación 1 litro.",
    sku: null,
    isAvailable: true,
    stock: 10,
  },
  {
    name: "MAX COLOR 1 LITRO",
    description:
      "Detergente líquido con poder de limpieza extra, ideal para prendas de colores. Proporciona un lavado profundo mientras mantiene los colores vibrantes, presentación 1 litro.",
    sku: null,
    isAvailable: true,
    stock: 10,
  },
];

describe("ranking con catalogo real", () => {
  test("'detergente para ropa de color' pone MAX COLOR primero (caso original)", () => {
    const names = rank("detergente para ropa de color", REAL_CATALOG);
    expect(names[0]).toBe("MAX COLOR 1 LITRO");
  });
});

describe("scoreProduct / ranking", () => {
  test("'detergente para ropa de color' pone MAX COLOR primero", () => {
    const names = rank("detergente para ropa de color");
    expect(names[0]).toBe("MAX COLOR 4 LITROS");
    expect(names).toContain("DETERCLORO 1 LITRO");
  });

  test("'detergente ropa negra' pone MAX NEGRO primero", () => {
    const names = rank("detergente ropa negra");
    expect(names[0]).toBe("MAX NEGRO 4 LITROS");
  });

  test("nombre exacto gana siempre (protege resolveOrderItems)", () => {
    const queryNorm = normalizeText("DETERCLORO 4 LITROS");
    const tokens = tokenizeQuery("DETERCLORO 4 LITROS");
    const exact = CATALOG.find((p) => p.name === "DETERCLORO 4 LITROS")!;
    const exactScore = scoreProduct(queryNorm, tokens, exact);
    expect(exactScore).toBeGreaterThanOrEqual(100);
    expect(rank("DETERCLORO 4 LITROS")[0]).toBe("DETERCLORO 4 LITROS");
  });

  test("SKU exacto queda primero", () => {
    expect(rank("MAX-C04")[0]).toBe("MAX COLOR 4 LITROS");
  });

  test("sin coincidencia devuelve score 0", () => {
    const p = CATALOG[0]!;
    expect(scoreProduct(normalizeText("escoba"), tokenizeQuery("escoba"), p)).toBe(0);
  });
});

describe("extractPresentation / extractProductGroupKey", () => {
  test("extrae litros y agrupa por linea", () => {
    expect(extractPresentation("DETERCLORO 4 LITROS")).toBe("4L");
    expect(extractProductGroupKey("DETERCLORO 4 LITROS")).toBe("DETERCLORO");
    expect(extractProductGroupKey("DETERCLORO 1 LITRO")).toBe("DETERCLORO");
  });
  test("sin presentacion devuelve el nombre como grupo", () => {
    expect(extractPresentation("ESCOBA PLASTICA")).toBeNull();
    expect(extractProductGroupKey("ESCOBA PLASTICA")).toBe("ESCOBA PLASTICA");
  });
});

describe("combineScores", () => {
  test("prioriza vector cuando ambos aportan", () => {
    expect(combineScores(0.9, 10)).toBeGreaterThan(combineScores(0.2, 10));
  });
  test("heuristica sola cuando vector es 0", () => {
    expect(combineScores(0, 50)).toBe(0.15);
  });
});

describe("diversifyByGroup", () => {
  interface Hit {
    name: string;
    group: string;
  }
  const hits: Hit[] = [
    { name: "DETERCLORO 1 LITRO", group: "DETERCLORO" },
    { name: "DETERCLORO 4 LITROS", group: "DETERCLORO" },
    { name: "DETERCLORO 10 LITROS", group: "DETERCLORO" },
    { name: "DETERCLORO 20 LITROS", group: "DETERCLORO" },
    { name: "MAX COLOR 4 LITROS", group: "MAX COLOR" },
  ];

  test("maximo 2 presentaciones por grupo en la primera pasada; otros grupos entran al top", () => {
    const out = diversifyByGroup(hits, (h) => h.group, 4);
    const groups = out.map((h) => h.group);
    // MAX COLOR entra en tercera posicion (tras 2 Detercloro), no fuera del top.
    expect(groups.slice(0, 3)).toEqual(["DETERCLORO", "DETERCLORO", "MAX COLOR"]);
    // El cuarto lugar se rellena con un saltado porque sobraba espacio.
    expect(out.length).toBe(4);
  });

  test("con limite justo no entran mas de 2 del mismo grupo", () => {
    const out = diversifyByGroup(hits, (h) => h.group, 3);
    const groups = out.map((h) => h.group);
    expect(groups).toEqual(["DETERCLORO", "DETERCLORO", "MAX COLOR"]);
  });

  test("rellena con saltados si el limite no se llena", () => {
    const out = diversifyByGroup(hits, (h) => h.group, 5);
    expect(out.length).toBe(5);
  });

  test("respeta el limite", () => {
    expect(diversifyByGroup(hits, (h) => h.group, 2).length).toBe(2);
  });
});
