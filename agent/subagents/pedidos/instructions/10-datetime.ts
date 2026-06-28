import { defineDynamic, defineInstructions } from "eve/instructions";
import { temporalContextMarkdown } from "../../../lib/time.js";

/** Inyecta la fecha/hora actual del negocio cada turno (clave para agendar entregas). */
export default defineDynamic({
  events: {
    "turn.started": () =>
      defineInstructions({ markdown: temporalContextMarkdown() }),
  },
});
