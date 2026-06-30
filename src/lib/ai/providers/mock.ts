import { addDays, formatISO } from "date-fns";
import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import type { CustomerInsightAIProvider } from "./types";
import { formatHongKongDateTime } from "@/lib/timezone";

function countValidFollowUps(context: CustomerInsightContext): number {
  return context.recentFollowUps.filter((row) => row.isValidFollowUp === 1).length;
}

function deriveIntent(context: CustomerInsightContext): {
  intentLevel: "high" | "medium" | "low" | "unknown";
  intentScore: number;
  confidence: number;
} {
  const validCount = countValidFollowUps(context);
  const hasNextFollowUp = !!context.nextFollowUpAt;
  const stage = context.salesStage;

  if (validCount >= 2 && (stage === "negotiation" || stage === "proposal")) {
    return { intentLevel: "high", intentScore: 82, confidence: 0.78 };
  }
  if (validCount >= 1 || hasNextFollowUp) {
    return { intentLevel: "medium", intentScore: 58, confidence: 0.65 };
  }
  if (context.lastFollowUpAt) {
    return { intentLevel: "low", intentScore: 35, confidence: 0.55 };
  }
  return { intentLevel: "unknown", intentScore: 20, confidence: 0.4 };
}

function buildSuggestedFollowUpAt(context: CustomerInsightContext): string | null {
  if (context.nextFollowUpAt) {
    return context.nextFollowUpAt;
  }
  const base = context.lastFollowUpAt ? new Date(context.lastFollowUpAt) : new Date();
  return formatISO(addDays(base, 3), { representation: "complete" });
}

export const mockCustomerInsightProvider: CustomerInsightAIProvider = {
  kind: "mock",

  async analyzeCustomerInsight(context) {
    const intent = deriveIntent(context);
    const validCount = countValidFollowUps(context);
    const latestFollowUp = context.recentFollowUps[0] ?? null;

    const keySignals: string[] = [];
    if (validCount > 0) {
      keySignals.push(`已有 ${validCount} 筆有效跟進記錄`);
    }
    if (context.requestedProjectName) {
      keySignals.push(`已記錄需求項目：${context.requestedProjectName}`);
    }
    if (latestFollowUp?.customerIntent) {
      keySignals.push(`最近跟進意向：${latestFollowUp.customerIntent}`);
    }
    if (keySignals.length === 0) {
      keySignals.push("客戶資料已建立，但有效互動信號仍偏少");
    }

    const riskFlags: string[] = [];
    if (!context.lastValidFollowUpAt) {
      riskFlags.push("尚未建立有效跟進，客戶可能已冷卻");
    }
    if (context.nextFollowUpAt && context.nextFollowUpAt < new Date().toISOString()) {
      riskFlags.push("下次跟進時間已逾期");
    }
    if (context.status === "public_pool") {
      riskFlags.push("客戶位於公海池，需儘快重新建立聯繫");
    }

    const missingInformation: string[] = [];
    if (!context.requestedProjectName) {
      missingInformation.push("缺少明確的需求項目或服務名稱");
    }
    if (context.recentFollowUps.length === 0 && !context.lastFollowUpAt) {
      missingInformation.push("尚未記錄跟進互動，難以判斷客戶最新溝通狀態");
    }
    if (validCount === 0) {
      missingInformation.push("缺少有效跟進摘要，難以判斷客戶最新態度");
    }

    let nextBestAction = "安排一次電話或微信跟進，確認客戶當前需求與決策進度。";
    if (intent.intentLevel === "high") {
      nextBestAction = "在 48 小時內主動跟進，整理方案重點並確認下一步決策節點。";
    } else if (intent.intentLevel === "low") {
      nextBestAction = "以關懷式跟進重新激活互動，先確認客戶是否仍有需求。";
    } else if (intent.intentLevel === "unknown") {
      nextBestAction = "完成首次有效跟進，補充客戶需求、預算與時間預期。";
    }

    const suggestedFollowUpAt = buildSuggestedFollowUpAt(context);

    const customerSummary = `${context.customerName}（${context.customerType === "company" ? "企業" : "個人"}客戶），目前處於 ${context.salesStage} 階段，來源為 ${context.source}。`;

    const currentSituation = latestFollowUp
      ? `最近一次跟進為 ${formatHongKongDateTime(latestFollowUp.followUpTime)}，渠道 ${latestFollowUp.channel}，結果 ${latestFollowUp.outcome}。`
      : "目前尚無跟進記錄，建議儘快建立首次有效聯繫。";

    const suggestedEmployeeMessage = latestFollowUp
      ? `您好，我是 EchFront 的顧問。上次我們聊到「${latestFollowUp.summary.slice(0, 40)}…」，想確認您目前對 ${context.requestedProjectName ?? "相關方案"} 的想法，看看是否需要我再整理一版建議給您參考。`
      : `您好，我是 EchFront 的顧問。看到您對 ${context.requestedProjectName ?? "我們的服務"} 有興趣，想了解一下您目前的時間安排，方便我為您準備更合適的方案。`;

    return {
      ...intent,
      customerSummary,
      currentSituation,
      keySignals,
      riskFlags,
      missingInformation,
      nextBestAction,
      suggestedFollowUpAt,
      suggestedEmployeeMessage,
      reasoning:
        "Mock 分析根據銷售階段、有效跟進次數、下次跟進時間與客戶狀態生成，僅供內部參考。",
    };
  },
};
