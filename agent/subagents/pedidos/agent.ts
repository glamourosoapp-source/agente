import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Especialista en pedidos y ventas: busca productos, arma y crea pedidos, " +
    "cotizaciones, guarda direcciones, agenda entregas y registra documentos. " +
    "Delega aqui cuando el cliente quiere comprar, cotizar, dar su direccion, " +
    "agendar entrega o consultar el estado de un pedido. Dale en el mensaje: " +
    "productos y cantidades, intencion (cotizar/pedir/agendar) y datos del cliente.",
  model: process.env.GLAM_MODEL || "deepseek/deepseek-v4-flash",
});
