import { defineDynamic, defineInstructions } from "eve/instructions";
import { temporalContextMarkdown } from "../lib/time.js";

/**
 * Inyecta la fecha/hora actual del negocio en el system prompt en cada turno.
 *
 * Sin esto el modelo usa la fecha de su entrenamiento y calcula mal el dia de la
 * semana o el ano al interpretar "manana", "el jueves", etc. (clave para agendar
 * entregas). Se resuelve en `turn.started` para que la fecha siempre este al dia.
 */
export default defineDynamic({
  events: {
    "turn.started": () =>
      defineInstructions({ markdown: temporalContextMarkdown() }),
  },
});
