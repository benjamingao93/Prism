import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const generateContent = vi.fn();

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return {
    ...actual,
    GoogleGenAI: class {
      models = { generateContent };
    },
  };
});

process.env.GEMINI_API_KEY = "test-key";
const { ApiError } = await import("@google/genai");
const { LlmError, structuredCall, toResponseSchema } = await import("@/lib/llm");
const { ExpansionSchema } = await import("@/lib/query-expansion");
const { TranslationSchema } = await import("@/lib/translation");

const Schema = z.object({ answer: z.string() });
const opts = { model: "gemini-test", system: "sys", prompt: "hi", maxTokens: 100 };

beforeEach(() => {
  generateContent.mockReset();
});

describe("toResponseSchema", () => {
  it.each([
    ["expansion", ExpansionSchema],
    ["translation", TranslationSchema],
  ])("produces a plain JSON Schema for the %s schema", (_name, schema) => {
    const json = toResponseSchema(schema);
    expect(json).not.toHaveProperty("$schema");
    expect(json.type).toBe("object");
    // No nullable unions: they are outside the subset Gemini reliably supports.
    expect(JSON.stringify(json)).not.toContain('"null"');
  });
});

describe("structuredCall (Gemini)", () => {
  it("requests JSON output with the schema and validates the response", async () => {
    generateContent.mockResolvedValue({ text: '{"answer":"42"}', candidates: [{ finishReason: "STOP" }] });
    await expect(structuredCall(Schema, opts)).resolves.toEqual({ answer: "42" });
    const req = generateContent.mock.calls[0][0];
    expect(req.model).toBe("gemini-test");
    expect(req.config.responseMimeType).toBe("application/json");
    expect(req.config.responseJsonSchema).toMatchObject({ type: "object", required: ["answer"] });
    expect(req.config.systemInstruction).toBe("sys");
  });

  it("rejects output that does not match the schema", async () => {
    generateContent.mockResolvedValue({ text: '{"wrong":1}', candidates: [{ finishReason: "STOP" }] });
    await expect(structuredCall(Schema, opts)).rejects.toMatchObject({ kind: "invalid_output" });
  });

  it("rejects non-JSON output", async () => {
    generateContent.mockResolvedValue({ text: "not json", candidates: [{ finishReason: "STOP" }] });
    await expect(structuredCall(Schema, opts)).rejects.toMatchObject({ kind: "invalid_output" });
  });

  it("treats safety blocks as refusals", async () => {
    generateContent.mockResolvedValue({ text: undefined, candidates: [{ finishReason: "SAFETY" }] });
    await expect(structuredCall(Schema, opts)).rejects.toMatchObject({ kind: "refusal" });
  });

  it("treats truncated output as invalid", async () => {
    generateContent.mockResolvedValue({ text: '{"ans', candidates: [{ finishReason: "MAX_TOKENS" }] });
    await expect(structuredCall(Schema, opts)).rejects.toMatchObject({ kind: "invalid_output" });
  });

  it.each([
    [429, "rate_limited"],
    [403, "unavailable"],
    [500, "failed"],
  ])("maps HTTP %i to a %s error", async (status, kind) => {
    generateContent.mockImplementation(async () => {
      throw new ApiError({ message: "upstream", status });
    });
    let caught: unknown;
    try {
      await structuredCall(Schema, opts);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LlmError);
    expect((caught as InstanceType<typeof LlmError>).kind).toBe(kind);
  });
});
