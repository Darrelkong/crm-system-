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

const MIN_TEXT_LENGTH = 5;

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

  const summary = input.summary?.trim() ?? "";
  if (!summary) {
    errors.push({
      field: "summary",
      message: "跟进内容摘要必填",
      code: "FOLLOW_UP_SUMMARY_REQUIRED",
    });
  } else if (summary.length < MIN_TEXT_LENGTH) {
    errors.push({
      field: "summary",
      message: "跟进内容至少需要 5 个字",
      code: "FOLLOW_UP_SUMMARY_TOO_SHORT",
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
  if (!nextAt) {
    errors.push({
      field: "nextFollowUpAt",
      message: "请选择下次跟进时间",
      code: "NEXT_FOLLOW_UP_REQUIRED",
    });
  } else if (!isValidIsoDate(nextAt)) {
    errors.push({
      field: "nextFollowUpAt",
      message: "下次跟进时间格式无效",
      code: "INVALID_NEXT_FOLLOW_UP_TIME",
    });
  }

  const nextAction = input.nextAction?.trim() ?? "";
  if (!nextAction) {
    errors.push({
      field: "nextAction",
      message: "下一步行动必填",
      code: "NEXT_ACTION_REQUIRED",
    });
  } else if (nextAction.length < MIN_TEXT_LENGTH) {
    errors.push({
      field: "nextAction",
      message: "下一步行动至少需要 5 个字",
      code: "NEXT_ACTION_TOO_SHORT",
    });
  }

  return errors;
}
