import { defineDynamic, defineInstructions } from "eve/instructions";
import {
  catalogOverviewMarkdown,
  getCatalogCategories,
} from "../../../lib/ops/catalog-overview.js";
import { getTenant, type ToolCtxLike } from "../../../lib/tenant.js";

/**
 * Copia de `agent/instructions/20-catalog.ts` (las instrucciones NO se heredan
 * root→subagente): inyecta los rubros reales del catalogo para que la
 * prospeccion diga que vendemos sin ofrecer un "catalogo" inexistente.
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
