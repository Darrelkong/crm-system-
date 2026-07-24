import { z } from "zod";

const warningCodeSchema = z.enum([
  "TEXT_TOO_SHORT",
  "NEXT_ACTION_MISSING",
  "AMBIGUOUS_DATE",
  "POSSIBLE_FACT_ADDED",
  "INPUT_EMPTY",
  "INPUT_TOO_LONG",
]);

const noHtmlOrFence = (value: string) =>
  !/<[^>]+>/.test(value) && !/```/.test(value);

export const followUpOrganizeAiOutputSchema = z
  .object({
    organizedText: z
      .string()
      .min(1)
      .max(5000)
      .refine(noHtmlOrFence, "unsafe_markup"),
    extracted: z
      .object({
        businessNeed: z.string().max(500).nullable(),
        concerns: z.array(z.string().max(200)).max(10),
        documentStatus: z.array(z.string().max(200)).max(10),
        agreedFollowUpAt: z
          .object({
            rawText: z.string().max(200),
            isoCandidate: z.union([
              z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              z.null(),
            ]),
          })
          .strict()
          .nullable(),
        nextAction: z.string().max(500).nullable(),
      })
      .strict(),
    warnings: z
      .array(
        z
          .object({
            code: warningCodeSchema,
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

export type FollowUpOrganizeAiOutput = z.infer<
  typeof followUpOrganizeAiOutputSchema
>;

export function safeParseFollowUpOrganizeAiOutput(data: unknown) {
  return followUpOrganizeAiOutputSchema.safeParse(data);
}

export const FOLLOW_UP_ORGANIZE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["organizedText", "extracted", "warnings"],
  properties: {
    organizedText: { type: "string" },
    extracted: {
      type: "object",
      additionalProperties: false,
      required: [
        "businessNeed",
        "concerns",
        "documentStatus",
        "agreedFollowUpAt",
        "nextAction",
      ],
      properties: {
        businessNeed: { type: ["string", "null"] },
        concerns: { type: "array", items: { type: "string" } },
        documentStatus: { type: "array", items: { type: "string" } },
        agreedFollowUpAt: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["rawText", "isoCandidate"],
              properties: {
                rawText: { type: "string" },
                isoCandidate: { type: ["string", "null"] },
              },
            },
          ],
        },
        nextAction: { type: ["string", "null"] },
      },
    },
    warnings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code"],
        properties: {
          code: { type: "string" },
        },
      },
    },
  },
} as const;
