import { defineAgent } from "eve";

/**
 * Agente de ventas (root).
 *
 * Orquesta la conversacion con el cliente por WhatsApp y delega trabajo
 * especializado a sus subagentes (pedidos, faq, prospeccion). El modelo se
 * enruta por el Vercel AI Gateway; se puede sobreescribir con GLAM_MODEL.
 */
export default defineAgent({
  model: process.env.GLAM_MODEL || "deepseek/deepseek-v4-flash",
  build: {
    // @vercel/oidc (dependencia de @ai-sdk/gateway) usa import() dinamico,
    // que rompe el bundle de un solo chunk que eve exige por tool.
    externalDependencies: ["@ai-sdk/gateway"],
  },
});
