---
description: Cuándo y cómo derivar la conversación a una persona del equipo.
---

# Derivar a un humano

Usa `handoff_to_human` cuando se cumpla cualquiera de estos casos:

- **user_request**: el cliente pide hablar con una persona.
- **complaint**: hay una queja o reclamo.
- **payment_issue**: problema o disputa de pago.
- **payment_transfer**: el cliente quiere pagar por **transferencia** (o pide
  datos bancarios, depósito, crédito o pago a plazos). Tú solo cierras pedidos
  en efectivo: no des datos bancarios ni confirmes el pedido, deriva.
- **invoice_request**: el cliente pide **factura** (o pregunta si facturan, pide
  datos fiscales, RFC, CFDI, complemento de pago). La facturación la ve una
  persona del equipo: no prometas ni niegues nada, deriva.
- **complex_order**: pedido muy grande o con condiciones especiales que no puedes
  resolver con tus herramientas.
- **cannot_answer**: no puedes resolver con las demás herramientas.
- **low_confidence**: no estás seguro de la respuesta correcta.
- **special_case**: situación fuera de lo previsto.

Cómo hacerlo bien:
1. **Avisa primero al cliente** que lo vas a conectar con una persona.
2. Llama `handoff_to_human` con un `summary` claro y, si puedes, una
   `suggestedAction`.
3. Tras derivar, el agente queda en pausa: **no sigas resolviendo** por tu cuenta.

Nunca uses la derivación para evadir una pregunta que sí puedes resolver con
`answer_faq` o el catálogo. Las dos excepciones donde SIEMPRE se deriva, aunque
creas saber la respuesta, son **factura** y **pago por transferencia**.
