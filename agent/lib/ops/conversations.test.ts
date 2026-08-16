import { describe, expect, test } from "bun:test";
import { shouldPauseAgent, type ConversationState } from "./conversations.js";

function state(patch: Partial<ConversationState> = {}): ConversationState {
  return {
    conversationId: "c1",
    status: "active",
    isAgentActive: true,
    needsHumanReview: false,
    ...patch,
  };
}

describe("shouldPauseAgent", () => {
  test("no pausa una conversacion normal atendida por la IA", () => {
    expect(shouldPauseAgent(state())).toBe(false);
  });

  test("no pausa cuando todavia no hay conversacion (primer mensaje)", () => {
    expect(shouldPauseAgent(null)).toBe(false);
  });

  test("pausa cuando una persona tomo el control (status human)", () => {
    // Regresion: el guard leia la conversacion con `status = 'active'`, asi que
    // al tomar el control (status pasa a 'human') no encontraba la fila y el
    // agente respondia por encima de la persona.
    expect(shouldPauseAgent(state({ status: "human" }))).toBe(true);
  });

  test("pausa aunque el chat tomado tenga is_agent_active en true", () => {
    expect(shouldPauseAgent(state({ status: "human", isAgentActive: true }))).toBe(true);
  });

  test("pausa cuando el toggle desactivo la IA", () => {
    expect(shouldPauseAgent(state({ isAgentActive: false }))).toBe(true);
  });

  test("pausa cuando el handoff marco revision humana", () => {
    expect(shouldPauseAgent(state({ needsHumanReview: true }))).toBe(true);
  });

  test("vuelve a responder cuando se libera el chat a la IA", () => {
    expect(
      shouldPauseAgent(state({ status: "active", isAgentActive: true, needsHumanReview: false })),
    ).toBe(false);
  });
});
