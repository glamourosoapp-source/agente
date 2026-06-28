import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { getAvailableDeliveryDates, DELIVERY_WINDOWS } from "../lib/ops/delivery.js";

/**
 * Devuelve las proximas fechas de entrega disponibles (omite domingos) y las
 * ventanas horarias, para ofrecerlas al cliente.
 */
export default defineTool({
  description:
    "Devuelve las proximas fechas de entrega disponibles y las ventanas horarias. " +
    "Usala cuando el cliente pregunte cuando puede recibir su pedido o vayas a " +
    "agendar una entrega.",
  inputSchema: z.object({
    daysAhead: z.number().int().min(1).max(14).optional().describe("Cuantos dias mostrar (default 7)."),
  }),
  async execute({ daysAhead }, ctx) {
    getTenant(ctx); // valida tenant aunque la agenda sea deterministica
    return {
      ok: true,
      dates: getAvailableDeliveryDates(daysAhead),
      timeWindows: DELIVERY_WINDOWS,
    };
  },
});
