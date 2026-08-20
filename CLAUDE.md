# Agent — agente de WhatsApp (framework eve)

Agente conversacional de ventas construido con **eve** (Vercel), deployment independiente del Back. Recibe el webhook de Kapso (`POST /webhook`), lee el mismo Postgres del Back (`agent/lib/ops/*`, siempre filtrando por `organization_id`) y usa un puente HTTP best-effort al Back (`BACK_INTERNAL_URL/api/internal/agent/*`, header `x-agent-secret`). Detalle en [README.md](README.md); mapa del workspace: [../AGENTS.md](../AGENTS.md).

## Comandos

```bash
bun run dev          # eve dev (canal HTTP/TUI local en :2000)
bun run typecheck    # tsc --noEmit
bun run build        # eve build
bun run info         # eve info — debe dar 0 errores/0 warnings
bun run eval         # eve eval — requiere DATABASE_URL, key del gateway, GLAM_DEV_ORGANIZATION_ID y GLAM_DEV_CUSTOMER_PHONE (evals de pedidos)
```

## Gotchas de eve (costaron tiempo — no redescubrir)

- `eve eval` debe correrse **desde `Agent/`** (`cd .../Agent && bun run eval` en el mismo comando); desde la raíz dice "No evals found".
- Corridas interrumpidas dejan snapshots en `Agent/.eve/dev-runtime/snapshots/` que rompen el discovery ("eval files present in multiple locations") — borrarlos.
- El juez default (`deepseek-v4-flash`) a veces devuelve "Unknown score choice undefined" = flake de parseo, no fallo real; override con `GLAM_JUDGE_MODEL=anthropic/claude-haiku-4-5`. Con `--json` se ve el transcript real.
- Si `eve dev` entra en loop de `CorruptedEventLogError/REPLAY_DIVERGENCE`: `rm -rf .workflow-data` (estado dev-only, NO vive en `.eve/`).
- `eve dev` exige un solo chunk por tool: `@ai-sdk/gateway` va en `build.externalDependencies` de `defineAgent` (requiere `@vercel/nft` como devDependency).

## Reglas de dominio

- **Idempotencia**: `createOrder` usa `idempotencyKey` (`agent/lib/idempotency.ts`); en re-runs devuelve el pedido existente (`replayed: true`). Además hay dedupe entre sesiones: un pedido idéntico (cliente+total+items) en los últimos 5 min se devuelve como `replayed` en vez de duplicarse. Folios (ORD-/COT-) con `pg_advisory_xact_lock` por organización y fecha en `GLAM_TIMEZONE` (`businessDateStamp`).
- **Ningún pedido sin dirección** (`needsAddress`). Flujo canónico: `search_products → prepare_order → confirmación → confirm_order`.
- **Búsqueda con piso de relevancia**: hits solo-vectoriales bajo `PRODUCT_VECTOR_MIN_SCORE` (0.35) se descartan; confirmar existencia por nombre exige evidencia por tokens o vector ≥ 0.5 (`PRODUCT_VECTOR_STRONG_SCORE`). Items por nombre con varias presentaciones y sin match exacto → `summary.unresolved` (pedir aclaración).
- **Bidón automático en 20 L**: cada envase de 20 L de una línea líquida agrega un `BIDON` ($25) al pedido/cotización desde `lib/ops/bidon.ts` (no lo decide el modelo); el resumen lo lista y avisa que **si el cliente entrega los vacíos a cambio, el chofer no se los cobra** (el ajuste es en la entrega, nunca descuento). Excluye artículos de plástico/jarciería de "20 LITROS" (cesto, cubeta, palangana) y **no** aplica a 10 L (ahí se pregunta), **salvo override**: `products.variants.bidon` (checkbox del panel, `ProductHit.bidon`) fuerza el bidón en cualquier presentación (`true`, p. ej. 10 L que salen en bidón de 20) o lo apaga (`false`); espejo de `productCarriesReturnableContainer` en los `shared/`. Cotización→pedido no duplica la línea. Cobertura: `lib/ops/bidon.test.ts` + evals `pedidos/bidon-20l-automatico` y `pedidos/bidon-a-cambio`.
- **Factura y transferencia = handoff obligatorio**: el agente solo cierra pedidos en **efectivo** y ya no ofrece "efectivo o transferencia". Si el cliente pide factura (RFC/CFDI/datos fiscales) deriva con `handoff_to_human` (`invoice_request`); si quiere pagar por transferencia o pide datos bancarios, deriva con `payment_transfer` **antes de crear el pedido**. Reforzado en código: `agent/lib/payment-policy.ts` — `prepare_order` marca `requiresHuman` y `confirm_order`/`create_order`/`convert_quote_to_order` rechazan `paymentMethod: "transferencia"` sin escribir nada. Los motivos nuevos también van en `VALID_REASONS` del Back (`src/services/agent-bridge.service.ts`), si no degradan a `cannot_answer`. Cobertura: `lib/payment-policy.test.ts` + evals `pedidos/factura-escala` y `pedidos/transferencia-escala`.
- **El modelo no decide montos**: las tools de pedido no aceptan `discount` ni `deliveryFee` (el envío lo calcula `deliveryFeeFor`; descuentos = handoff). Cantidades enteras, máx 500 por item (`MAX_ITEM_QUANTITY`).
- **Media entrante**: el canal persiste el archivo vía bridge (el Back lo baja a `/uploads` y devuelve `mediaUrl`) y pasa una **nota sintética** al turno del agente con la URL; los comprobantes se registran con `process_document`. El agente no ve el contenido del archivo.
- **Disponibilidad**: criterio único `isEffectivelyAvailable` (products.ts) — con `GLAM_ENFORCE_STOCK=false` (default), `stock=0` = "no rastreado", NO agotado. Además, los productos con `products.unlimited_stock = true` (default de la columna, todo el catálogo actual) son **existencias infinitas**: nunca se agotan aunque se prenda el enforcement.
- Si `syncOrderCreated` falla, el pedido queda marcado en `internal_notes` ("Notificación al CRM pendiente") para reconciliar.
- **Skills e instrucciones NO se comparten** root↔subagentes: si editás un skill o una instrucción del root, actualizá las copias en `subagents/{pedidos,faq,prospeccion}/{skills,instructions}/` (p. ej. `10-datetime.ts` está copiado en pedidos y `20-catalog.ts` en prospección).
- **No existe catálogo/lista de precios para mandar**: el agente nunca lo ofrece ni lo promete. Para decir qué vendemos usa la sección "Rubros que SÍ manejamos" que inyecta `instructions/20-catalog.ts` desde el catálogo real (`lib/ops/catalog-overview.ts`, cacheado 10 min por organización); productos y precios concretos siempre por `search_products`. Cobertura: evals `atencion/saludo-inicial` y `atencion/sin-catalogo`.
- eve **no negocia fecha de entrega**: `get_available_dates` devuelve la fecha asignada; si el cliente insiste → `handoff_to_human`. El helper `agent/lib/delivery-schedule.ts` está triplicado con `Back/shared` y `Front/shared` — cambios van a los tres.
- Pedidos **y clientes** llevan `created_by` = usuario sistema "Agente IA" por organización (`agent/lib/ops/agent-user.ts`), con fallback a null. Los clientes nuevos llevan además `team_id` = equipo "Glamouroso IA" (`getAgentTeamId`, cacheado y auto-reparador si el usuario agente quedó sin equipo).
- Tenant solo por `organizationId`, resuelto por número de WhatsApp (`whatsapp_configs`); en local usar `GLAM_DEV_ORGANIZATION_ID`.
