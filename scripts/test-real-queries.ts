/**
 * Prueba de resolucion de vocabulario real de clientes contra el catalogo.
 * Uso: bun --env-file=.env.local scripts/test-real-queries.ts
 * Requiere DATABASE_URL y GLAM_DEV_ORGANIZATION_ID (y gateway para vector).
 */
import { searchProducts } from "../agent/lib/ops/products.js";

const tenant = {
  organizationId: process.env.GLAM_DEV_ORGANIZATION_ID!,
  customerPhone: null,
};

const QUERIES = [
  "pinol 20 litros",
  "fabuloso del amarillo",
  "cloro 20 litros",
  "suavitel",
  "suavizante de telas",
  "papel higienico 180",
  "hipoclorito envase 20",
  "lavatraste naranja",
  "trapeador de microfibra",
  "pastilla desodorante wissie",
  "fibra verde",
  "limpiador multiusos mar fresco",
  "base para mop 90 cm",
  "funda mop hilaza",
];

for (const q of QUERIES) {
  const hits = await searchProducts(tenant, q, { limit: 4, diversify: true });
  console.log(`\n=== "${q}" → ${hits.length} hits`);
  for (const h of hits) {
    console.log(
      `  ${h.score.toFixed(2)} (h:${h.heuristicScore.toFixed(0)} v:${h.vectorScore.toFixed(2)}) ${h.name} — $${h.price} [${h.presentation ?? "-"}]`,
    );
  }
}
process.exit(0);
