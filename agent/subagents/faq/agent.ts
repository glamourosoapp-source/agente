import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Especialista en preguntas frecuentes del negocio (horarios, formas de pago, " +
    "envios, cobertura, devoluciones, politicas). Delega aqui cuando el cliente " +
    "pregunta por informacion general de Glamouroso. Pasa la pregunta tal cual.",
  model: process.env.GLAM_MODEL || "deepseek/deepseek-v4-flash",
});
