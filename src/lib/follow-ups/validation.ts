import { isFollowUpChannel } from "@/lib/constants/follow-up-channels";
import { isFollowUpOutcome } from "@/lib/constants/follow-up-outcomes";

export type FollowUpInput = {
  followUpTime?: string;
  channel?: string;
  outcome?: string;
  summary?: string;
  customerIntent?: string | null;
  nextFollowUpAt?: string | null;
  nextAction?: string | null;
};

export type ValidationFieldError = { field: string; message: string; code: string };

function isValidIsoDate(value: string): boolean {
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

export function validateFollowUpInput(
  input: FollowUpInput,
): ValidationFieldError[] {
  const errors: ValidationFieldError[] = [];

  if (!input.channel || !isFollowUpChannel(input.channel)) {
    errors.push({
      field: "channel",
      message: "请选择有效的跟进渠道",
      code: "FOLLOW_UP_CHANNEL_REQUIRED",
    });
  }

  if (!input.outcome || !isFollowUpOutcome(input.outcome)) {
    errors.push({
      field: "outcome",
      message: "请选择有效的跟进结果",
      code: "FOLLOW_UP_OUTCOME_REQUIRED",
    });
  }

  if (!input.summary?.trim()) {
    errors.push({
      field: "summary",
      message: "跟进内容摘要必填",
      code: "FOLLOW_UP_SUMMARY_REQUIRED",
    });
  }

  if (input.followUpTime && !isValidIsoDate(input.followUpTime)) {
    errors.push({
      field: "followUpTime",
      message: "跟进时间格式无效",
      code: "INVALID_FOLLOW_UP_TIME",
    });
  }

  const nextAt = input.nextFollowUpAt?.trim();
  if (nextAt && !isValidIsoDate(nextAt)) {
    errors.push({
      field: "nextFollowUpAt",
      message: "下次跟进时间格式无效",
      code: "INVALID_NEXT_FOLLOW_UP_TIME",
    });
  }

  return errors;
}
