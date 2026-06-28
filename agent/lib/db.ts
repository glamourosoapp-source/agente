import postgres from "postgres";

/**
 * Cliente Postgres compartido (singleton perezoso).
 *
 * Apunta al MISMO Postgres que usa el backend (Sequelize). En serverless
 * (Vercel) se mantiene el pool pequeno y `prepare: false` para ser compatible
 * con poolers tipo PgBouncer en modo transaction.
 *
 * Nota de seguridad multi-tenant: este modulo NO conoce el tenant. Toda
 * consulta que cruce datos de clientes/pedidos/productos debe filtrar por
 * `organization_id` usando el contexto que resuelve `lib/tenant.ts` desde la
 * sesion, nunca desde input del modelo.
 */

type Sql = ReturnType<typeof postgres>;

let _sql: Sql | null = null;

function sslOption(): postgres.Options<Record<string, never>>["ssl"] {
  const mode = (process.env.DB_SSL ?? "").toLowerCase();
  if (mode === "require") return "require";
  if (mode === "prefer") return "prefer";
  if (mode === "disable" || mode === "") return undefined;
  return mode as postgres.Options<Record<string, never>>["ssl"];
}

export function getSql(): Sql {
  if (_sql) return _sql;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL no esta configurada. glamouroso-agent necesita acceso al Postgres del CRM.",
    );
  }

  _sql = postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 3),
    idle_timeout: 20,
    connect_timeout: 10,
    // Compatibilidad con poolers (PgBouncer transaction mode) en serverless.
    prepare: false,
    ssl: sslOption(),
    // Evita ruido de NOTICE en logs de la funcion.
    onnotice: () => {},
  });

  return _sql;
}

/** Cierra el pool (util en scripts/tests; no se usa en el runtime normal). */
export async function closeSql(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
  }
}
