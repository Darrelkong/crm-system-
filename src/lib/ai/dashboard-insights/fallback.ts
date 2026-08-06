import type { AdminBriefInsight, StaffTodayActionsInsight } from "./types";
import type { AdminAiProviderContext } from "./context/admin-context";
import type { StaffAiProviderContext } from "./context/staff-context";

export function buildDeterministicAdminBrief(
  context: AdminAiProviderContext,
): AdminBriefInsight {
  const priorities: AdminBriefInsight["priorities"] = [];

  if (context.metrics.pendingApprovals > 0) {
    priorities.push({
      category: "approvals",
      title: "处理待审批事项",
      reason: `当前有 ${context.metrics.pendingApprovals} 项待审批。`,
      urgency: context.metrics.pendingApprovals >= 5 ? "urgent" : "attention",
    });
  }

  if (context.metrics.overdueFollowUps > 0) {
    priorities.push({
      category: "follow_up",
      title: "关注逾期跟进",
      reason: `团队当前有 ${context.metrics.overdueFollowUps} 位客户逾期跟进；其中 ${context.teamAggregates.staffWithOverdueCount} 位成员存在逾期客户。`,
      urgency: "attention",
    });
  }

  if (context.metrics.autoReleaseTomorrow > 0) {
    priorities.push({
      category: "reclamation",
      title: "留意明日自动释放风险",
      reason: `有 ${context.metrics.autoReleaseTomorrow} 位客户可能在明日进入自动释放流程。`,
      urgency: "urgent",
    });
  } else if (context.metrics.autoReleaseWithin7Days > 0) {
    priorities.push({
      category: "reclamation",
      title: "留意 7 天内释放风险",
      reason: `有 ${context.metrics.autoReleaseWithin7Days} 位客户处于 7 天内自动释放风险范围。`,
      urgency: "attention",
    });
  }

  if (context.metrics.publicPoolEnteredToday > 0) {
    priorities.push({
      category: "public_pool",
      title: "查看今日公共池新增",
      reason: `今日已有 ${context.metrics.publicPoolEnteredToday} 位客户进入公共池。`,
      urgency: "normal",
    });
  }

  if (context.stageDistribution.length > 0) {
    const topStage = [...context.stageDistribution].sort(
      (a, b) => b.count - a.count,
    )[0];
    if (topStage) {
      priorities.push({
        category: "pipeline",
        title: "关注主要阶段分布",
        reason: `当前最多客户处于阶段 ${topStage.stageKey}（${topStage.count} 位，占 ${topStage.percentage}%）。`,
        urgency: "normal",
      });
    }
  }

  return {
    headline: "基于系统数据的管理摘要",
    summary:
      priorities.length > 0
        ? "以下建议根据当前 Dashboard 汇总数据生成，供管理参考。"
        : "当前未发现需要立即关注的团队运营异常。",
    priorities: priorities.slice(0, 6),
    cautions: ["本摘要基于系统数据，不包含客户个人资料。"],
  };
}

export function buildDeterministicStaffActions(
  context: StaffAiProviderContext,
): StaffTodayActionsInsight {
  const actions: StaffTodayActionsInsight["actions"] = [];

  for (const customer of context.customers) {
    if (customer.followUpStatus === "overdue") {
      actions.push({
        customerRef: customer.ref,
        category: "overdue",
        title: `优先跟进 ${customer.ref}`,
        reason: `该客户已逾期跟进${customer.overdueHours ? `约 ${customer.overdueHours} 小时` : ""}。`,
        urgency: "urgent",
      });
    } else if (customer.followUpStatus === "due_today") {
      actions.push({
        customerRef: customer.ref,
        category: "follow_up",
        title: `今日跟进 ${customer.ref}`,
        reason: "该客户今日需要跟进。",
        urgency: "attention",
      });
    } else if (
      customer.reclamationDaysRemaining !== undefined &&
      customer.reclamationDaysRemaining <= 7
    ) {
      actions.push({
        customerRef: customer.ref,
        category: "reclamation",
        title: `关注释放风险 ${customer.ref}`,
        reason: `该客户约在 ${customer.reclamationDaysRemaining} 天内可能进入自动释放流程。`,
        urgency: "attention",
      });
    }
    if (actions.length >= 8) break;
  }

  if (context.metrics.pendingWorkItems > 0) {
    actions.push({
      category: "work_item",
      title: "处理待办事项",
      reason: `你当前有 ${context.metrics.pendingWorkItems} 项待处理事项。`,
      urgency: "attention",
    });
  }

  return {
    headline: "基于系统数据的今日行动建议",
    actions: actions.slice(0, 8),
  };
}
