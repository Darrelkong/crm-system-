import { Card } from "@/components/ui/card";
import {
  HEAT_LEVEL_BADGE_CLASS,
  HEAT_LEVEL_LABELS,
} from "@/lib/customers/scoring/constants";
import type { CustomerWithScores } from "@/lib/customers/scoring/service";
import type { HeatLevel } from "@/lib/customers/scoring/types";

export function HeatBadge({ level }: { level: HeatLevel }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${HEAT_LEVEL_BADGE_CLASS[level]}`}
    >
      {HEAT_LEVEL_LABELS[level]}
    </span>
  );
}

export function CompletenessBadge({ score }: { score: number }) {
  const variant =
    score >= 80
      ? "bg-green-100 text-green-800"
      : score >= 60
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-800";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${variant}`}>
      {score} 分
    </span>
  );
}

export function CustomerScoresCards({
  scores,
  showMissingFields,
}: {
  scores: Pick<
    CustomerWithScores,
    | "heatLevel"
    | "completenessScore"
    | "heatReason"
    | "completenessMissingFields"
    | "accessLevel"
  >;
  showMissingFields: boolean;
}) {
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
      <Card>
        <h3 className="text-sm font-semibold text-slate-900">客户热度</h3>
        <div className="mt-2">
          <HeatBadge level={scores.heatLevel} />
        </div>
        {scores.heatReason && (
          <p className="mt-2 text-sm text-slate-600">{scores.heatReason}</p>
        )}
        <p className="mt-3 text-xs text-slate-500">
          基于有效跟进、销售阶段、下次跟进与自动回收预警规则动态计算。
        </p>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-slate-900">数据完整度</h3>
        <p className="mt-2 text-2xl font-semibold text-slate-900">
          {scores.completenessScore}
          <span className="ml-1 text-sm font-normal text-slate-500">/ 100</span>
        </p>
        {showMissingFields &&
        scores.completenessMissingFields &&
        scores.completenessMissingFields.length > 0 ? (
          <div className="mt-3">
            <p className="text-xs font-medium text-slate-600">待完善项：</p>
            <ul className="mt-1 list-inside list-disc text-sm text-slate-600">
              {scores.completenessMissingFields.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          </div>
        ) : scores.accessLevel !== "full" ? (
          <p className="mt-2 text-xs text-slate-500">
            完整度分数可见；缺失项详情仅负责人或管理员可查看。
          </p>
        ) : (
          <p className="mt-2 text-sm text-green-700">资料已较完整</p>
        )}
      </Card>
    </div>
  );
}
