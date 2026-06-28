import { getSql } from "../db.js";
import { embedQuery, toPgVectorLiteral } from "../embeddings.js";
import type { TenantContext } from "../tenant.js";

export interface FaqHit {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  score: number;
}

const VECTOR_WEIGHT = 0.7;
const HEURISTIC_WEIGHT = 0.3;
/** Umbral para responder directamente sin pasar por el modelo. */
export const DIRECT_ANSWER_THRESHOLD = 0.78;

function tokenize(text: string): Set<string> {
  return new Set(
    (text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

/** Similitud heuristica simple (Jaccard sobre tokens). */
function heuristicScore(query: string, candidate: string): number {
  const a = tokenize(query);
  const b = tokenize(candidate);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

interface RawFaqRow {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  vector_score: number | null;
}

async function fetchCandidates(
  tenant: TenantContext,
  query: string,
  limit: number,
): Promise<RawFaqRow[]> {
  const sql = getSql();

  // Intento con busqueda vectorial; si no hay gateway/embedding, cae a heuristica.
  try {
    const vector = await embedQuery(query);
    const literal = toPgVectorLiteral(vector);
    return await sql<RawFaqRow[]>`
      SELECT id, question, answer, category,
        CASE
          WHEN question_embedding IS NOT NULL
          THEN 1 - (question_embedding <=> ${literal}::vector)
          ELSE NULL
        END AS vector_score
      FROM faqs
      WHERE is_active = true
        AND deleted_at IS NULL
        AND organization_id = ${tenant.organizationId}
      ORDER BY vector_score DESC NULLS LAST
      LIMIT ${limit * 3}
    `;
  } catch {
    return await sql<RawFaqRow[]>`
      SELECT id, question, answer, category, NULL::float8 AS vector_score
      FROM faqs
      WHERE is_active = true
        AND deleted_at IS NULL
        AND organization_id = ${tenant.organizationId}
      LIMIT 200
    `;
  }
}

/** Busqueda hibrida de FAQs (vector + heuristica), ya combinada y ordenada. */
export async function searchFaqs(
  tenant: TenantContext,
  query: string,
  limit = 3,
): Promise<FaqHit[]> {
  const rows = await fetchCandidates(tenant, query, limit);

  const scored: FaqHit[] = rows.map((r) => {
    const vector = typeof r.vector_score === "number" ? r.vector_score : 0;
    const heuristic = heuristicScore(query, `${r.question} ${r.answer}`);
    const score =
      r.vector_score === null
        ? heuristic
        : VECTOR_WEIGHT * vector + HEURISTIC_WEIGHT * heuristic;
    return {
      id: r.id,
      question: r.question,
      answer: r.answer,
      category: r.category,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Si hay una FAQ con confianza suficiente, devuelve su respuesta directa.
 * En otro caso devuelve los mejores candidatos para que el modelo redacte.
 */
export async function answerFaq(
  tenant: TenantContext,
  query: string,
): Promise<
  | { kind: "direct"; answer: string; faqId: string; score: number }
  | { kind: "candidates"; candidates: FaqHit[] }
> {
  const hits = await searchFaqs(tenant, query, 3);
  const top = hits[0];
  if (top && top.score >= DIRECT_ANSWER_THRESHOLD) {
    return { kind: "direct", answer: top.answer, faqId: top.id, score: top.score };
  }
  return { kind: "candidates", candidates: hits };
}
