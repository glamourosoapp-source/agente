import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { getAssignedDeliveryDate } from "../lib/ops/delivery.js";

/**
 * Devuelve la fecha de entrega que el negocio asigna segun la hora del pedido
 * (regla de corte configurada) y las ventanas horarias disponibles.
 */
export default defineTool({
  description:
    "Devuelve la fecha de entrega que asigna el negocio segun la hora del pedido " +
    "(regla de corte; NO es negociable) y las ventanas horarias disponibles. " +
    "Usala para informar al cliente cuando llegara su pedido y ofrecerle elegir " +
    "solo la ventana horaria.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const tenant = getTenant(ctx);
    const assigned = await getAssignedDeliveryDate(tenant);
    return {
      ok: true,
      date: assigned.date,
      dayName: assigned.dayName,
      timeWindows: assigned.timeWindows,
      note:
        "Informa la fecha tal cual; no ofrezcas otras fechas ni aceptes cambios. " +
        "Solo la ventana horaria es elegible.",
    };
  },
});
