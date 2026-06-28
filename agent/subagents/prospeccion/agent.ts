import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Especialista en prospeccion: atiende a prospectos de campaña que responden " +
    "por primera vez. Se presenta, despierta interes en el catalogo de Glamouroso " +
    "y, si el prospecto quiere, lo lleva hacia una cotizacion o pedido. Delega aqui " +
    "cuando el contacto es un prospecto y aun no es cliente.",
  model: process.env.GLAM_MODEL || "deepseek/deepseek-v4-flash",
});
