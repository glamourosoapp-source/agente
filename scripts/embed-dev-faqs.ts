/**
 * Utilidad DEV: embebe las FAQs sin embedding de la organizacion usando el
 * mismo gateway/modelo que usa el agente (util cuando el Back local no tiene
 * key valida del gateway). En prod los embeddings los genera FAQService.
 * Uso: bun --env-file=.env.local scripts/embed-dev-faqs.ts
 * Requiere DATABASE_URL y GLAM_DEV_ORGANIZATION_ID.
 */
import { getSql } from "../agent/lib/db.js";
import { embedQuery, toPgVectorLiteral } from "../agent/lib/embeddings.js";

const organizationId = process.env.GLAM_DEV_ORGANIZATION_ID;
if (!organizationId) {
  console.error("Falta GLAM_DEV_ORGANIZATION_ID");
  process.exit(1);
}

const model = process.env.GLAM_EMBEDDING_MODEL || "openai/text-embedding-3-small";
const sql = getSql();
const rows = await sql<{ id: string; question: string; answer: string }[]>`
  SELECT id, question, answer
  FROM faqs
  WHERE organization_id = ${organizationId}
    AND deleted_at IS NULL
    AND embedding_status <> 'ready'
`;

let updated = 0;
for (const faq of rows) {
  const [q, a] = await Promise.all([embedQuery(faq.question), embedQuery(faq.answer)]);
  await sql`
    UPDATE faqs
    SET question_embedding = ${toPgVectorLiteral(q)}::vector,
        answer_embedding = ${toPgVectorLiteral(a)}::vector,
        embedding_model = ${model},
        embedding_status = 'ready',
        embedding_updated_at = now(),
        updated_at = now()
    WHERE id = ${faq.id}
  `;
  updated += 1;
}

console.log(JSON.stringify({ scanned: rows.length, updated }));
process.exit(0);
