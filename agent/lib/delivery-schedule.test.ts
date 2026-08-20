import { describe, expect, it } from "bun:test";
import {
  computeScheduledDeliveryDate,
  DEFAULT_DELIVERY_SCHEDULE,
  resolveDeliveryScheduleConfig,
} from "./delivery-schedule";

// America/Mexico_City es UTC-6 (sin DST desde 2022): 20:59Z = 14:59 local.
// Calendario usado: 2026-07-15 miércoles, 17 viernes, 18 sábado, 19 domingo,
// 20 lunes, 21 martes.
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

  describe("regla de fin de semana (dayOverrides default)", () => {
    it("sábado antes de las 14:00 → lunes", () => {
      // sábado 13:59 MX
      expect(computeScheduledDeliveryDate(at("2026-07-18T19:59:00Z"))).toBe("2026-07-20");
    });

    it("sábado a las 14:00 exactas (corte inclusivo) → martes", () => {
      expect(computeScheduledDeliveryDate(at("2026-07-18T20:00:00Z"))).toBe("2026-07-21");
    });

    it("sábado entre 14:00 y 15:00 usa el corte del sábado, no el general → martes", () => {
      // sábado 14:30 MX: antes del corte general (15:00) pero después del sabatino (14:00)
      expect(computeScheduledDeliveryDate(at("2026-07-18T20:30:00Z"))).toBe("2026-07-21");
    });

    it("sábado después de las 15:00 → martes", () => {
      expect(computeScheduledDeliveryDate(at("2026-07-18T22:00:00Z"))).toBe("2026-07-21");
    });

    it("domingo en la mañana → martes", () => {
      expect(computeScheduledDeliveryDate(at("2026-07-19T16:00:00Z"))).toBe("2026-07-21");
    });

    it("domingo en la noche → martes", () => {
      expect(computeScheduledDeliveryDate(at("2026-07-19T23:00:00Z"))).toBe("2026-07-21");
    });

    it("cambiar el corte general no toca el corte sabatino", () => {
      // sábado 13:00 MX con corte general 09:00: manda el override del sábado (14:00) → lunes
      expect(
        computeScheduledDeliveryDate(at("2026-07-18T19:00:00Z"), { cutoffTime: "09:00" })
      ).toBe("2026-07-20");
    });

    it("dayOverrides: {} desactiva la regla de fin de semana", () => {
      // sábado 16:00 MX sin overrides → +2 = lunes (comportamiento previo)
      expect(
        computeScheduledDeliveryDate(at("2026-07-18T22:00:00Z"), { dayOverrides: {} })
      ).toBe("2026-07-20");
    });
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
    // Los overrides de fin de semana se conservan si no se tocan.
    expect(cfg.dayOverrides).toEqual(DEFAULT_DELIVERY_SCHEDULE.dayOverrides);
  });

  it("no muta los defaults al resolver", () => {
    const cfg = resolveDeliveryScheduleConfig({ dayOverrides: { saturday: null } });
    expect(cfg.dayOverrides.saturday).toBeUndefined();
    expect(DEFAULT_DELIVERY_SCHEDULE.dayOverrides.saturday).toBeDefined();
  });

  it("dayOverrides: null elimina la regla del día, objeto válido la reemplaza", () => {
    const cfg = resolveDeliveryScheduleConfig({
      dayOverrides: {
        sunday: null,
        saturday: { cutoffTime: "12:00", offsetBeforeCutoffDays: 2, offsetAfterCutoffDays: 4 },
      },
    });
    expect(cfg.dayOverrides.sunday).toBeUndefined();
    expect(cfg.dayOverrides.saturday).toEqual({
      cutoffTime: "12:00",
      offsetBeforeCutoffDays: 2,
      offsetAfterCutoffDays: 4,
    });
  });

  it("dayOverrides inválidos se ignoran y quedan los defaults", () => {
    const cfg = resolveDeliveryScheduleConfig({
      dayOverrides: {
        saturday: { cutoffTime: "99:99", offsetAfterCutoffDays: -1 },
        lunes: { cutoffTime: "10:00" },
      },
    });
    expect(cfg.dayOverrides).toEqual(DEFAULT_DELIVERY_SCHEDULE.dayOverrides);
  });
});
