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
3. **Arma el resumen**: `prepare_order` con los items y cantidades.
   - Si devuelve `needsAddress`: pide la dirección (texto, pin o link de Maps),
     guárdala con `save_customer_location`, confírmala y vuelve a `prepare_order`.
4. **Confirma con el cliente**: muéstrale el resumen (productos, cantidades,
   total) y pide un "sí" explícito.
5. **Crea el pedido**: `confirm_order` solo tras el "sí". Comparte el número de
   pedido (ORD-...) y el total.
6. **Entrega**: la fecha la asigna el sistema automáticamente al crear el pedido
   (regla de corte del negocio) y viene en `scheduledDeliveryDate` de
   `confirm_order`. **Confírmasela al cliente tal cual** — no ofrezcas fechas ni
   aceptes cambiarla; si insiste en otra fecha, usa `handoff_to_human`. Sí
   pregúntale qué ventana horaria prefiere y regístrala con `schedule_delivery`.

Reglas duras:
- Sin dirección NO hay pedido.
- Nunca uses precios que no vengan de `search_products`.
- **La fecha de entrega no se negocia con el cliente**; solo la ventana horaria.
- `create_order` es solo para casos excepcionales ya confirmados en un paso.
