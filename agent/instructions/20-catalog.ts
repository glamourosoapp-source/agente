import { defineDynamic, defineInstructions } from "eve/instructions";
import {
  catalogOverviewMarkdown,
  getCatalogCategories,
} from "../lib/ops/catalog-overview.js";
import { getTenant, type ToolCtxLike } from "../lib/tenant.js";

/**
 * Inyecta los rubros REALES del catalogo en el system prompt de cada turno.
 *
 * Sin esto el agente no sabe que vendemos hasta llamar a `search_products`, y
 * en el saludo terminaba ofreciendo "el catalogo" — que no existe como
 * documento (ver la FAQ de lista de precios). Con la lista en el prompt puede
 * decir que rubros manejamos sin inventar ninguno (regla de oro).
 *
 * Falla en silencio: si no hay tenant o la DB no responde, el turno sigue sin
 * esta seccion en vez de romperse.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      try {
        const tenant = getTenant(ctx as unknown as ToolCtxLike);
        const categories = await getCatalogCategories(tenant);
        const markdown = catalogOverviewMarkdown(categories);
        return markdown ? defineInstructions({ markdown }) : null;
      } catch {
        return null;
      }
    },
  },
});
