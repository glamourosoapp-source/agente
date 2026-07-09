import { embed } from "ai";
import { gateway } from "@ai-sdk/gateway";

/**
 * Genera el embedding de una consulta para la busqueda semantica de FAQs.
 *
 * Debe usar el MISMO modelo con el que se indexaron las FAQs en la base
 * (text-embedding-3-small, 1536 dimensiones). Se enruta por el Vercel AI
 * Gateway igual que las llamadas al modelo del agente.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const model = process.env.GLAM_EMBEDDING_MODEL || "openai/text-embedding-3-small";
  const { embedding } = await embed({
    model: gateway.textEmbeddingModel(model),
    value: text,
    // Una conexión colgada al gateway no debe congelar la búsqueda del agente;
    // el llamador cae a búsqueda heurística si esto falla.
    abortSignal: AbortSignal.timeout(15_000),
  });
  return embedding;
}

/** Serializa un vector al literal que entiende pgvector ("[0.1,0.2,...]"). */
export function toPgVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
