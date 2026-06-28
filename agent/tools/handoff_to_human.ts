import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { escalate } from "../lib/bridge.js";

/**
 * Deriva la conversacion a una persona del equipo.
 *
 * Marca la conversacion como `needs_human_review` en el CRM, adjunta un brief
 * para el asistente humano y dispara notificacion + realtime en el Dashboard.
 * Tras escalar, el agente queda pausado (no responde) hasta que un humano libere
 * el control. Avisa SIEMPRE al cliente que lo conectaras con una persona.
 */
export default defineTool({
  description:
    "Deriva la conversacion a una persona del equipo (peticion explicita de " +
    "humano, cliente molesto, queja, pedido complejo, problema de pago, baja " +
    "confianza o caso especial fuera de tu alcance). Notifica al equipo y pausa " +
    "al agente. Avisa SIEMPRE al cliente que lo conectaras con una persona.",
  inputSchema: z.object({
    reason: z
      .enum([
        "user_request",
        "cannot_answer",
        "complaint",
        "complex_order",
        "payment_issue",
        "low_confidence",
        "special_case",
      ])
      .describe(
        "Motivo: user_request (pidio humano), cannot_answer (no se puede resolver), " +
          "complaint (queja), complex_order (pedido complejo), payment_issue (problema de pago), " +
          "low_confidence (baja confianza), special_case (caso especial).",
      ),
    summary: z.string().min(3).describe("Resumen breve del caso para el asistente humano."),
    suggestedAction: z.string().optional().describe("Accion sugerida para quien retome."),
    customerMessage: z.string().optional().describe("Ultimo mensaje relevante del cliente."),
  }),
  async execute({ reason, summary, suggestedAction, customerMessage }, ctx) {
    const tenant = getTenant(ctx);
    if (!tenant.customerPhone) {
      return { ok: false, message: "No tengo el telefono del cliente para registrar la derivacion." };
    }

    const result = await escalate({
      organizationId: tenant.organizationId,
      customerPhone: tenant.customerPhone,
      reason,
      summary,
      suggestedAction,
      customerMessage,
    });

    if (!result) {
      return {
        ok: false,
        escalated: false,
        message:
          "No pude registrar la derivacion en este momento. Avisa al cliente que una " +
          "persona lo contactara y continua con empatia.",
      };
    }

    return {
      ok: true,
      escalated: true,
      reason: result.derivationReason,
      message:
        "Conversacion derivada al equipo. Confirma al cliente que una persona lo " +
        "atendera y no sigas resolviendo por tu cuenta.",
    };
  },
});
