# glamouroso-agent

Agente conversacional de ventas para el CRM Glamouroso, construido con el
framework **[eve](https://eve.dev)** de Vercel (filesystem-first + Workflow SDK
durable). Atiende WhatsApp vía Kapso: toma pedidos, arma cotizaciones, responde
preguntas frecuentes, hace prospección y escala a un humano cuando hace falta.

Es el reemplazo del agente in-process `Back/src/services/agent-graph` (LangGraph)
y espejo del agente que ya corre en producción en CRM-MEDICO (`agente-arx`).

## Arquitectura

- **Deployment independiente.** Recibe el webhook de Kapso por su cuenta
  (`POST /webhook`) e inicia/reanuda una sesión durable por cliente.
- **Lee el mismo Postgres del Back** directamente (`agent/lib/ops/*`), siempre
  filtrando por `organization_id` resuelto desde el número de WhatsApp.
- **Puente HTTP al Back** (`BACK_INTERNAL_URL/api/internal/agent/*`, header
  `x-agent-secret`) para persistir mensajes en el Dashboard, emitir realtime y
  escalar a humano. Es tolerante a fallos: si el Back no responde, el cliente
  igual recibe respuesta (el guard de pausa cae a Postgres directo).

## Estructura

```
agent/
├── agent.ts            # agente raíz (modelo + orquestación a subagentes)
├── instructions/       # system prompt (ventas) + contexto temporal por turno
├── channels/kapso.ts   # webhook Kapso / WhatsApp
├── lib/                # infraestructura (db, redis, kapso, tenant, bridge, ...)
│   └── ops/            # acceso a datos por dominio (products, orders, faq, ...)
├── tools/              # herramientas que invoca el modelo
├── subagents/          # pedidos, faq, prospeccion
└── skills/             # procedimientos cargados por contexto
```

## Desarrollo local

```bash
cp .env.example .env     # rellena DATABASE_URL, GLAM_DEV_ORGANIZATION_ID y el gateway
npm install              # (o bun install)
npm run dev              # eve dev — abre el canal HTTP/TUI local
npm run typecheck        # tsc --noEmit
```

El tenant en producción se resuelve SIEMPRE desde el número de WhatsApp
(`whatsapp_configs`). En local, define `GLAM_DEV_ORGANIZATION_ID` para probar por
el canal HTTP/TUI sin un número real.

## Tenant

El multi-tenant de Glamouroso es **solo por organización** (`organizationId`); no
hay segunda dimensión (a diferencia del `doctorId` de CRM-MEDICO). Todas las
consultas de `lib/ops/*` filtran por `organization_id` del tenant de la sesión,
nunca por input del modelo.
# agente
