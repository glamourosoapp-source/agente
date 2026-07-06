---
description: Cómo responder preguntas de información del negocio sin inventar.
---

# Responder dudas del negocio

- Para cualquier dato del negocio (horarios, formas de pago, envíos, cobertura,
  devoluciones, garantías, políticas) usa `answer_faq` con la pregunta del
  cliente tal cual.
- Si `answer_faq` devuelve `kind: "direct"`, responde con esa información.
- Si devuelve candidatos, redacta una respuesta breve apoyándote en ellos.
- Si ninguna FAQ aplica o no hay resultados, **no inventes**: dilo con honestidad
  y, si la duda es relevante, ofrece derivar con `handoff_to_human`.
- No mezcles aquí la toma de pedidos; eso es del flujo de pedido.
