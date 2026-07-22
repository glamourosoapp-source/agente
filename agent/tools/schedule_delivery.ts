import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { scheduleDelivery } from "../lib/ops/delivery.js";

/**
 * Registra la ventana horaria preferida del cliente. La fecha de entrega la
 * asigna el sistema al crear el pedido y NO se cambia desde aqui.
 */
export default defineTool({
  description:
    "Registra la ventana horaria preferida del cliente para la entrega de su " +
    "pedido. La FECHA de entrega la asigna el sistema automaticamente y NO se " +
    "cambia aqui: solo confirmala al cliente. Usa get_available_dates para " +
    "conocer la fecha asignada y las ventanas disponibles.",
  inputSchema: z.object({
    orderNumber: z.string().min(3).describe("Numero del pedido (ORD-...)."),
    timeWindow: z.string().optional().describe("Ventana horaria elegida, p. ej. 09:00-13:00."),
  }),
  async execute(input, ctx) {
    const tenant = getTenant(ctx);
    const result = await scheduleDelivery(tenant, input);
    if (!result.ok) return { ok: false, message: result.message };
    return {
      ok: true,
      orderNumber: result.orderNumber,
      date: result.date,
      dayName: result.dayName,
      timeWindow: result.timeWindow,
      note: "Confirma al cliente la fecha asignada y la ventana registrada. La fecha no se negocia.",
    };
  },
});
