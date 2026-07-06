import { defineEvalConfig } from "eve/evals";

/**
 * Config compartida de evals.
 *
 * Requisitos para correr `eve eval` en local:
 * - DATABASE_URL apuntando al Postgres del CRM (con productos/FAQs seed).
 * - Credenciales del Vercel AI Gateway (modelo del agente y del judge).
 * - GLAM_DEV_ORGANIZATION_ID: las sesiones de eval no entran por el canal de
 *   Kapso, asi que el tenant se resuelve con el fallback de desarrollo.
 */
export default defineEvalConfig({
  judge: { model: process.env.GLAM_JUDGE_MODEL || "deepseek/deepseek-v4-flash" },
});
