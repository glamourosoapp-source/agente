---
description: Procedimiento canónico para tomar un pedido de principio a fin (productos, dirección, confirmación, entrega).
---

# Tomar un pedido (flujo canónico)

Sigue SIEMPRE este orden. No te saltes pasos ni inventes datos.

1. **Identifica al cliente** (opcional pero útil): `lookup_customer` para saludar
   por su nombre y saber si ya tiene dirección guardada y su tier de precios.
   Si tiene dirección o ubicaciones guardadas, pregunta si envías ahí antes de pedir una nueva.
2. **Encuentra los productos**: `search_products` con lo que pide. Confirma
   nombre, unidad y precio reales. Si no aparece, pide que lo describa distinto.
   Si dices para qué sirve un producto, básate solo en su campo `description`;
   nunca lo inventes ni se lo atribuyas a otro producto con nombre parecido.
   - Marcas que diga el cliente (Fabuloso, Pinol, Suavitel...) = TIPO de
     producto, no el nuestro: muestra los equivalentes y confirma tipo y
     presentación antes de armar; no asumas que el primer resultado es "su" marca.
   - "N litros de X": si existe la presentación de N litros, propónsela y
     confirma que es UN envase de N litros, no N unidades.
3. **Arma el resumen**: `prepare_order` con los items y cantidades (usa el `id`
   de la presentación que eligió el cliente).
   - Si devuelve `needsAddress`: pide la dirección (texto, pin o link de Maps),
     guárdala con `save_customer_location`, confírmala y vuelve a `prepare_order`.
   - Si `summary.unresolved` trae items, esos NO quedaron en el pedido: díselo al
     cliente y resuélvelo (aclarar presentación o cantidad) antes de continuar.
4. **Confirma con el cliente**: muéstrale el resumen (productos, cantidades,
   envío y total) y pide un "sí" explícito. Pregunta también la forma de pago
   (efectivo o transferencia) si aún no la sabes.
5. **Crea el pedido**: `confirm_order` solo tras el "sí", pasando `paymentMethod`.
   Manda la **nota completa**: número de pedido (ORD-...), cada producto con
   cantidad y precio, total, dirección y fecha asignada. Si paga por
   transferencia, dile que puede mandar su comprobante por este mismo chat.
   - **Bidón a cambio**: en presentaciones en bidón (10 L / 20 L), pregunta si
     entregará un bidón vacío; si NO, agrega el producto `BIDON` del catálogo
     como item del pedido. No restes nada por el bidón (política en `answer_faq`).
6. **Entrega**: la fecha la asigna el sistema automáticamente al crear el pedido
   (regla de corte del negocio) y viene en `scheduledDeliveryDate` de
   `confirm_order`. **Confírmasela al cliente tal cual** — no ofrezcas fechas ni
   aceptes cambiarla; si insiste en otra fecha, usa `handoff_to_human`. Sí
   pregúntale qué ventana horaria prefiere y regístrala con `schedule_delivery`.

Reglas duras:
- Sin dirección NO hay pedido.
- Nunca uses precios que no vengan de `search_products`.
- **La fecha de entrega no se negocia con el cliente**; solo la ventana horaria.
- No apliques descuentos ni cambies el costo de envío: eso lo autoriza una
  persona del equipo (deriva con `handoff_to_human` si el cliente lo exige).
- `create_order` es solo para casos excepcionales ya confirmados en un paso.
