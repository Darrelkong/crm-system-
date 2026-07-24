import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import {
  buildSystemPrompt,
  serializeCustomerInsightContext,
} from "@/lib/ai/customer-insights/prompt-builder";
import { AI_SETTING_DEFAULTS, DEFAULT_AI_PROMPT_TEMPLATE } from "@/lib/settings/ai-keys";

function buildSampleContext(
  overrides: Partial<CustomerInsightContext> = {},
): CustomerInsightContext {
  return {
    customerId: "customer-uuid",
    customerName: "測試客戶",
    customerType: "individual",
    salesStage: "lead",
    source: "web",
    status: "active",
    requestedProjectName: "專案 A",
    sourceRemark: "來源備註",
    notes: "內部備註內容",
    lastFollowUpAt: "2026-06-29T10:00:00.000Z",
    lastValidFollowUpAt: "2026-06-29T10:00:00.000Z",
    nextFollowUpAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    includeSensitiveFields: true,
    phone: "91234567",
    wechatId: "wx_test_user",
    email: "customer@example.com",
    recentFollowUps: [
      {
        id: "follow-up-1",
        followUpTime: "2026-06-29T10:00:00.000Z",
        channel: "wechat",
        outcome: "interested",
        summary: "客戶表示下週再聯絡",
        nextAction: null,
        customerIntent: "high",
        isValidFollowUp: 1,
        nextFollowUpAt: "2026-07-01T10:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("serializeCustomerInsightContext", () => {
  it("serializes sanitized context without structured contact fields", () => {
    const context = buildSampleContext();
    const serialized = serializeCustomerInsightContext(context);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;

    assert.equal("phone" in parsed, false);
    assert.equal("wechatId" in parsed, false);
    assert.equal("email" in parsed, false);
    assert.ok(typeof parsed.contactAvailability === "object" && parsed.contactAvailability !== null);
    assert.equal(parsed.initialCommunicationNote, "內部備註內容");
    assert.equal(parsed.sourceRemark, "來源備註");
    assert.equal(parsed.includeSensitiveFields, undefined);
  });

  it("does not mutate the original context", () => {
    const context = buildSampleContext();

    serializeCustomerInsightContext(context);

    assert.equal(context.phone, "91234567");
    assert.equal(context.wechatId, "wx_test_user");
    assert.equal(context.email, "customer@example.com");
    assert.equal(context.includeSensitiveFields, true);
  });

  it("preserves follow-up summary and customerIntent in serialized output", () => {
    const context = buildSampleContext();
    const serialized = serializeCustomerInsightContext(context);
    const parsed = JSON.parse(serialized) as {
      recentFollowUps: Array<{ summary: string; customerIntent: string | null }>;
    };

    assert.equal(parsed.recentFollowUps.length, 1);
    assert.equal(parsed.recentFollowUps[0]?.summary, "客戶表示下週再聯絡");
    assert.equal(parsed.recentFollowUps[0]?.customerIntent, "high");
  });
});

describe("buildSystemPrompt", () => {
  it("requires one raw JSON object without markdown or explanations", () => {
    const prompt = buildSystemPrompt("zh-Hans");
    assert.match(prompt, /Return only one valid JSON object/);
    assert.match(prompt, /Do not include markdown fences/);
    assert.match(prompt, /Do not include explanations before or after the JSON/);
  });
});

describe("serializeCustomerInsightContext contactAvailability privacy", () => {
  it("serialized JSON contains contactAvailability object", () => {
    const context = buildSampleContext();
    const parsed = JSON.parse(serializeCustomerInsightContext(context)) as Record<string, unknown>;
    assert.equal(typeof parsed.contactAvailability, "object");
    assert.notEqual(parsed.contactAvailability, null);
  });

  it("serialized JSON does not contain phone key", () => {
    const parsed = JSON.parse(serializeCustomerInsightContext(buildSampleContext())) as Record<string, unknown>;
    assert.equal("phone" in parsed, false);
  });

  it("serialized JSON does not contain wechatId key", () => {
    const parsed = JSON.parse(serializeCustomerInsightContext(buildSampleContext())) as Record<string, unknown>;
    assert.equal("wechatId" in parsed, false);
  });

  it("serialized JSON does not contain email key", () => {
    const parsed = JSON.parse(serializeCustomerInsightContext(buildSampleContext())) as Record<string, unknown>;
    assert.equal("email" in parsed, false);
  });

  it("serialized JSON does not contain raw phone value string", () => {
    const context = buildSampleContext({ phone: "98765432" });
    assert.equal(serializeCustomerInsightContext(context).includes("98765432"), false);
  });

  it("serialized JSON does not contain raw wechatId value string", () => {
    const context = buildSampleContext({ wechatId: "wx_unique_handle_99" });
    assert.equal(serializeCustomerInsightContext(context).includes("wx_unique_handle_99"), false);
  });

  it("serialized JSON does not contain raw email value string", () => {
    const context = buildSampleContext({ email: "uniqueemail99@example.com" });
    assert.equal(serializeCustomerInsightContext(context).includes("uniqueemail99@example.com"), false);
  });

  it("serialized JSON does not contain masked contact placeholder", () => {
    assert.equal(serializeCustomerInsightContext(buildSampleContext()).includes("****"), false);
  });

  it("contactAvailability reflects actual presence of contact fields", () => {
    const withPhone = buildSampleContext({ phone: "91234567", wechatId: null, email: null });
    const serialized = serializeCustomerInsightContext(withPhone);
    const parsed = JSON.parse(serialized) as { contactAvailability: Record<string, unknown> };
    assert.equal(parsed.contactAvailability.hasPhone, true);
    assert.equal(parsed.contactAvailability.hasWeChat, false);
    assert.equal(parsed.contactAvailability.hasEmail, false);
    assert.equal(parsed.contactAvailability.hasAnyContactMethod, true);
  });
});

describe("buildSystemPrompt contactAvailability guidance", () => {
  it("system prompt references contactAvailability", () => {
    const prompt = buildSystemPrompt("zh-Hans");
    assert.match(prompt, /contactAvailability/);
  });

  it("system prompt instructs not to flag missing contact when hasAnyContactMethod is true", () => {
    const prompt = buildSystemPrompt("zh-Hans");
    assert.match(prompt, /hasAnyContactMethod/);
  });

  it("system prompt includes guidance about not re-collecting existing contact info", () => {
    const prompt = buildSystemPrompt("en");
    assert.match(prompt, /re-collect/);
  });
});

describe("buildSystemPrompt business background", () => {
  it("system prompt describes the company as providing overseas identity and immigration services", () => {
    const prompt = buildSystemPrompt("en");
    assert.match(prompt, /overseas identity planning/i);
    assert.match(prompt, /immigration/i);
  });

  it("system prompt mentions Hong Kong and US immigration advisory", () => {
    const prompt = buildSystemPrompt("en");
    assert.match(prompt, /Hong Kong/i);
    assert.match(prompt, /US immigration/i);
  });

  it("system prompt mentions cross-border business support", () => {
    const prompt = buildSystemPrompt("en");
    assert.match(prompt, /cross-border/i);
  });

  it("system prompt clarifies AI role is to help staff, not make final commitments", () => {
    const prompt = buildSystemPrompt("en");
    assert.match(prompt, /final commitments/i);
  });
});

describe("buildSystemPrompt compliance rules", () => {
  it("system prompt forbids guaranteeing approval outcomes", () => {
    const prompt = buildSystemPrompt("en");
    assert.match(prompt, /Do not guarantee/);
  });

  it("system prompt forbids absolute-promise phrases like 'guaranteed to succeed'", () => {
    const prompt = buildSystemPrompt("en");
    assert.match(prompt, /guaranteed to succeed/);
    assert.match(prompt, /definitely approved/);
  });

  it("system prompt forbids legal, tax, investment, and financial advice", () => {
    const prompt = buildSystemPrompt("en");
    assert.match(prompt, /legal, tax, investment, or financial advice/);
  });

  it("system prompt requires deferring institutional outcomes to relevant authority", () => {
    const prompt = buildSystemPrompt("en");
    assert.match(prompt, /subject to final review by the relevant authority/);
  });

  it("system prompt forbids speculating about client assets or finances without evidence", () => {
    const prompt = buildSystemPrompt("en");
    assert.match(prompt, /Do not speculate/);
  });

  it("system prompt requires using missingInformation instead of guessing", () => {
    const prompt = buildSystemPrompt("en");
    assert.match(prompt, /missingInformation/);
  });
});

describe("DEFAULT_AI_PROMPT_TEMPLATE nextBestAction guidance", () => {
  it("template includes nextBestAction rules section", () => {
    assert.match(DEFAULT_AI_PROMPT_TEMPLATE, /nextBestAction rules/i);
  });

  it("template forbids vague 'follow up' or 'communicate further' as the entire action", () => {
    assert.match(DEFAULT_AI_PROMPT_TEMPLATE, /do not only say.*follow up/i);
  });

  it("template requires 2–3 practical questions when information is missing", () => {
    assert.match(DEFAULT_AI_PROMPT_TEMPLATE, /2.{1,3}3 practical questions/i);
  });

  it("template recommends WeChat as preferred channel when available", () => {
    assert.match(DEFAULT_AI_PROMPT_TEMPLATE, /hasWeChat/);
    assert.match(DEFAULT_AI_PROMPT_TEMPLATE, /WeChat/);
  });

  it("template advises low-pressure and no over-promise in nextBestAction", () => {
    assert.match(DEFAULT_AI_PROMPT_TEMPLATE, /low-pressure/i);
    assert.match(DEFAULT_AI_PROMPT_TEMPLATE, /do not over-promise/i);
  });
});

describe("DEFAULT_AI_PROMPT_TEMPLATE suggestedEmployeeMessage guidance", () => {
  it("template includes suggestedEmployeeMessage rules section", () => {
    assert.match(DEFAULT_AI_PROMPT_TEMPLATE, /suggestedEmployeeMessage rules/i);
  });

  it("template requires natural tone, not a customer service bot", () => {
    assert.match(DEFAULT_AI_PROMPT_TEMPLATE, /not a customer service bot/i);
  });

  it("template limits message to 1–3 sentences suitable for WeChat or SMS", () => {
    assert.match(DEFAULT_AI_PROMPT_TEMPLATE, /1.{1,3}3 sentences/i);
    assert.match(DEFAULT_AI_PROMPT_TEMPLATE, /WeChat or SMS/i);
  });

  it("template prohibits hard-sell and over-promise in message", () => {
    assert.match(DEFAULT_AI_PROMPT_TEMPLATE, /Do not hard-sell/i);
    assert.match(DEFAULT_AI_PROMPT_TEMPLATE, /do not over-promise/i);
  });
});

describe("AI_SETTING_DEFAULTS prompt version", () => {
  it("ai_prompt_version default is phase-1d-v1", () => {
    assert.equal(AI_SETTING_DEFAULTS.ai_prompt_version, "phase-1d-v1");
  });
});

describe("serializeCustomerInsightContext initialCommunicationNote", () => {
  it("serialized JSON contains initialCommunicationNote key", () => {
    const parsed = JSON.parse(serializeCustomerInsightContext(buildSampleContext())) as Record<string, unknown>;
    assert.ok("initialCommunicationNote" in parsed);
  });

  it("initialCommunicationNote value equals the notes value from context", () => {
    const context = buildSampleContext({ notes: "原始詢問內容" });
    const parsed = JSON.parse(serializeCustomerInsightContext(context)) as Record<string, unknown>;
    assert.equal(parsed.initialCommunicationNote, "原始詢問內容");
  });

  it("serialized JSON top level does not contain a notes key", () => {
    const parsed = JSON.parse(serializeCustomerInsightContext(buildSampleContext())) as Record<string, unknown>;
    assert.equal("notes" in parsed, false);
  });

  it("initialCommunicationNote is null when notes is null", () => {
    const context = buildSampleContext({ notes: null });
    const parsed = JSON.parse(serializeCustomerInsightContext(context)) as Record<string, unknown>;
    assert.equal(parsed.initialCommunicationNote, null);
  });

  it("initialCommunicationNote is truncated when notes exceeds the character limit", () => {
    const longNote = "首次溝通備註".repeat(400);
    const context = buildSampleContext({ notes: longNote });
    const parsed = JSON.parse(serializeCustomerInsightContext(context)) as Record<string, unknown>;
    assert.ok(typeof parsed.initialCommunicationNote === "string");
    assert.ok((parsed.initialCommunicationNote as string).includes("[truncated]"));
    assert.ok((parsed.initialCommunicationNote as string).length < longNote.length);
  });

  it("recentFollowUps still present alongside initialCommunicationNote", () => {
    const parsed = JSON.parse(serializeCustomerInsightContext(buildSampleContext())) as Record<string, unknown>;
    assert.ok("initialCommunicationNote" in parsed);
    assert.ok(Array.isArray(parsed.recentFollowUps));
  });

  it("sourceRemark is preserved separately from initialCommunicationNote", () => {
    const context = buildSampleContext({ sourceRemark: "透過朋友介紹", notes: "客戶希望申請香港身份" });
    const parsed = JSON.parse(serializeCustomerInsightContext(context)) as Record<string, unknown>;
    assert.equal(parsed.sourceRemark, "透過朋友介紹");
    assert.equal(parsed.initialCommunicationNote, "客戶希望申請香港身份");
  });
});

describe("buildSystemPrompt initialCommunicationNote guidance", () => {
  it("system prompt mentions initialCommunicationNote", () => {
    const prompt = buildSystemPrompt("en");
    assert.match(prompt, /initialCommunicationNote/);
  });

  it("system prompt states initialCommunicationNote contains original inquiry and intent at first contact", () => {
    const prompt = buildSystemPrompt("en");
    assert.match(prompt, /original inquiry/i);
    assert.match(prompt, /first contact/i);
  });

  it("system prompt instructs to always consider initialCommunicationNote together with recentFollowUps", () => {
    const prompt = buildSystemPrompt("en");
    assert.match(prompt, /Always consider initialCommunicationNote together with recentFollowUps/);
  });

  it("system prompt instructs not to rely only on recentFollowUps when initialCommunicationNote exists", () => {
    const prompt = buildSystemPrompt("en");
    assert.match(prompt, /Do not rely only on recentFollowUps when initialCommunicationNote exists/);
  });

  it("system prompt handles null initialCommunicationNote case with fallback to recentFollowUps", () => {
    const prompt = buildSystemPrompt("en");
    assert.match(prompt, /null or empty/i);
    assert.match(prompt, /recentFollowUps/);
  });
});

describe("DEFAULT_AI_PROMPT_TEMPLATE initialCommunicationNote guidance", () => {
  it("template contains initialCommunicationNote field description", () => {
    assert.match(DEFAULT_AI_PROMPT_TEMPLATE, /initialCommunicationNote/);
  });

  it("template describes initialCommunicationNote as the client's original note at first contact", () => {
    assert.match(DEFAULT_AI_PROMPT_TEMPLATE, /original note recorded at first contact/i);
  });

  it("template requires using initialCommunicationNote together with recentFollowUps", () => {
    assert.match(DEFAULT_AI_PROMPT_TEMPLATE, /initialCommunicationNote together with recentFollowUps/i);
  });

  it("template instructs not to ignore the initial note when follow-up records exist", () => {
    assert.match(DEFAULT_AI_PROMPT_TEMPLATE, /do not ignore the initial note when follow-up records exist/i);
  });
});
