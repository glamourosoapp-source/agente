import { describe, expect, it } from "bun:test";
import { isOptOutMessage } from "./opt-out";

describe("isOptOutMessage", () => {
  const optOuts = [
    "Ya no me escribas",
    "ya no me escribas por favor",
    "No me escriban más",
    "no me mandes mensajes",
    "NO ME MOLESTEN",
    "deja de escribirme",
    "Dejen de mandar mensajes porfa",
    "quítame de la lista",
    "bórrenme de su lista",
    "sácame de esta lista",
    "no quiero más mensajes",
    "no quiero recibir publicidad",
    "baja",
    "STOP",
    "no me vuelvas a escribir",
    "no nos contacten",
    "ya no me llames",
  ];

  const notOptOuts = [
    "ahorita no, gracias",
    "hoy no puedo, luego te escribo",
    "no me interesa por el momento",
    "al rato te mando el pedido",
    "no me alcanza esta semana",
    "mándame la lista de precios",
    "¿me escribes mañana?",
    "quiero darme de baja del pedido", // baja de pedido ≠ baja de contacto (frase larga)
    "no me llegó el mensaje",
    "escríbeme la dirección por favor",
    "sí me interesa, mándame información",
  ];

  for (const text of optOuts) {
    it(`detecta opt-out: "${text}"`, () => {
      expect(isOptOutMessage(text)).toBe(true);
    });
  }

  for (const text of notOptOuts) {
    it(`NO marca opt-out: "${text}"`, () => {
      expect(isOptOutMessage(text)).toBe(false);
    });
  }
});
