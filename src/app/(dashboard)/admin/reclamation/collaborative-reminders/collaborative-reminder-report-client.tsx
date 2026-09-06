"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import { formatHongKongDateTime } from "@/lib/timezone";
import type { CollaborationReminderCandidate } from "@/lib/customers/collaboration-reminders";

export function CollaborativeReminderReportClient() {
  const [candidates, setCandidates] = useState<CollaborationReminderCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch("/api/admin/reclamation/collaborative-reminders");
      const body = (await response.json()) as {
        candidates?: CollaborationReminderCandidate[];
      };
      setCandidates(body.candidates ?? []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial report fetch on mount
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageIntro
        title="协作客户跟进提醒报告"
        description="协作关系长期有效。只有主负责人及所有协作成员连续 10 天没有有效跟进时，系统才会提醒相关成员。"
        action={
          <Button
            type="button"
            variant="secondary"
            disabled={loading || refreshing}
            onClick={() => void load(true)}
          >
            {refreshing ? "重新整理中…" : "重新整理"}
          </Button>
        }
      />
      {loading ? (
        <div className="surface-card p-6 text-sm text-[#6B7890]">载入中…</div>
      ) : candidates.length === 0 ? (
        <div className="surface-card p-6">
          <EmptyState message="目前没有待跟进的协作客户。" />
        </div>
      ) : (
        <div className="surface-card overflow-x-auto p-4">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#E3E8F0] text-xs text-[#6B7890]">
                <th className="px-3 py-2">客户</th>
                <th className="px-3 py-2">最后有效跟进</th>
                <th className="px-3 py-2">未跟进天数</th>
                <th className="px-3 py-2">提醒周期</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.customerId} className="border-b border-[#EEF3F8]">
                  <td className="px-3 py-3 font-medium text-[#172033]">
                    {candidate.customerName}
                  </td>
                  <td className="px-3 py-3 text-[#516078]">
                    {formatHongKongDateTime(candidate.lastParticipantFollowUpAt)}
                  </td>
                  <td className="px-3 py-3 text-[#172033]">
                    {candidate.daysWithoutFollowUp}
                  </td>
                  <td className="px-3 py-3 text-[#172033]">
                    第 {candidate.intervalNumber} 个 10 天周期
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
