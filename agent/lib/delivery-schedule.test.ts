import { describe, expect, it } from "bun:test";
import {
  computeScheduledDeliveryDate,
  DEFAULT_DELIVERY_SCHEDULE,
  resolveDeliveryScheduleConfig,
} from "./delivery-schedule";

// America/Mexico_City es UTC-6 (sin DST desde 2022): 20:59Z = 14:59 local.
const MX = "America/Mexico_City";
const at = (iso: string) => new Date(iso);

describe("computeScheduledDeliveryDate", () => {
  it("antes del corte aplica offsetBeforeCutoffDays (miércoles 14:59 → jueves)", () => {
    expect(computeScheduledDeliveryDate(at("2026-07-15T20:59:00Z"))).toBe("2026-07-16");
  });

  it("el corte es inclusivo: 15:00 exactas aplica offsetAfterCutoffDays (miércoles → viernes)", () => {
    expect(computeScheduledDeliveryDate(at("2026-07-15T21:00:00Z"))).toBe("2026-07-17");
  });

  it("después del corte (miércoles 15:01 → viernes)", () => {
    expect(computeScheduledDeliveryDate(at("2026-07-15T21:01:00Z"))).toBe("2026-07-17");
  });

  it("sábado después del corte cae en lunes (salta domingo)", () => {
    // sábado 2026-07-18 16:00 MX → +2 = lunes 20 (no toca domingo, pero verifica fin de semana)
    expect(computeScheduledDeliveryDate(at("2026-07-18T22:00:00Z"))).toBe("2026-07-20");
  });

  it("sábado antes del corte: +1 caería domingo → lunes", () => {
    expect(computeScheduledDeliveryDate(at("2026-07-18T18:00:00Z"))).toBe("2026-07-20");
  });

  it("viernes después del corte: +2 caería domingo → lunes", () => {
    expect(computeScheduledDeliveryDate(at("2026-07-17T22:00:00Z"))).toBe("2026-07-20");
  });

  it("skipSundays=false permite domingo", () => {
    expect(
      computeScheduledDeliveryDate(at("2026-07-17T22:00:00Z"), { skipSundays: false })
    ).toBe("2026-07-19");
  });

  it("offset 0 entrega el mismo día", () => {
    expect(
      computeScheduledDeliveryDate(at("2026-07-15T15:00:00Z"), { offsetBeforeCutoffDays: 0 })
    ).toBe("2026-07-15");
  });

  it("evalúa el corte en la timezone del negocio, no la del servidor", () => {
    // 23:30Z del día 15 = 17:30 MX (después del corte) pero 08:30 del día 16 en Tokio (antes).
    expect(computeScheduledDeliveryDate(at("2026-07-15T23:30:00Z"), { timezone: MX })).toBe(
      "2026-07-17"
    );
    expect(
      computeScheduledDeliveryDate(at("2026-07-15T23:30:00Z"), { timezone: "Asia/Tokyo" })
    ).toBe("2026-07-17"); // 16 jul + 1
  });

  it("cruce de medianoche en la timezone del negocio (02:00Z = día anterior en MX)", () => {
    // 2026-07-16T02:00Z = 15 jul 20:00 MX → después del corte → 17 jul
    expect(computeScheduledDeliveryDate(at("2026-07-16T02:00:00Z"))).toBe("2026-07-17");
  });

  it("cutoff configurable", () => {
    // 10:00 MX con corte 09:00 → después del corte
    expect(
      computeScheduledDeliveryDate(at("2026-07-15T16:00:00Z"), { cutoffTime: "09:00" })
    ).toBe("2026-07-17");
  });
});

describe("resolveDeliveryScheduleConfig", () => {
  it("devuelve defaults con entrada vacía o inválida", () => {
    expect(resolveDeliveryScheduleConfig(undefined)).toEqual(DEFAULT_DELIVERY_SCHEDULE);
    expect(resolveDeliveryScheduleConfig("basura")).toEqual(DEFAULT_DELIVERY_SCHEDULE);
    expect(resolveDeliveryScheduleConfig({ cutoffTime: "25:99", offsetAfterCutoffDays: -3 })).toEqual(
      DEFAULT_DELIVERY_SCHEDULE
    );
  });

  it("hace merge parcial sobre defaults", () => {
    const cfg = resolveDeliveryScheduleConfig({ cutoffTime: "13:30", skipSundays: false });
    expect(cfg.cutoffTime).toBe("13:30");
    expect(cfg.skipSundays).toBe(false);
    expect(cfg.offsetAfterCutoffDays).toBe(2);
  });
});
