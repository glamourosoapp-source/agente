import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { scheduleDelivery } from "../lib/ops/delivery.js";

/**
 * Agenda la entrega de un pedido (fecha + ventana horaria).
 */
export default defineTool({
  description:
    "Agenda la entrega de un pedido existente: fija la fecha (YYYY-MM-DD) y la " +
    "ventana horaria. Usa get_available_dates antes para ofrecer opciones validas. " +
    "Los domingos no hay entregas.",
  inputSchema: z.object({
    orderNumber: z.string().min(3).describe("Numero del pedido a agendar (ORD-...)."),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Fecha de entrega YYYY-MM-DD."),
    timeWindow: z.string().optional().describe("Ventana horaria, p. ej. 09:00-13:00."),
  }),
  async execute(input, ctx) {
    const tenant = getTenant(ctx);
    const result = await scheduleDelivery(tenant, input);
    if (!result.ok) return { ok: false, message: result.message };
    return {
      ok: true,
      orderNumber: result.orderNumber,
      date: result.date,
      timeWindow: result.timeWindow,
      note: "Confirma al cliente la fecha y ventana de entrega.",
    };
  },
});
