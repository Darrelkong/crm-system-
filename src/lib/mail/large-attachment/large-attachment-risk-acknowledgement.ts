export const LARGE_ATTACHMENT_NOTICE_VERSION =
  "large_attachment_notice_v1" as const;

export const LARGE_ATTACHMENT_RISK_ACKNOWLEDGEMENT_TEXT = [
  "当前系统暂未对大附件进行自动安全扫描。请您在上传前自行确认文件内容合法、合规、安全，并确保您拥有上传、使用及发送该文件所需的相关授权。",
  "请勿上传含有病毒、木马、恶意程序、违法违规内容、侵权内容或其他可能危害系统、用户或第三方的文件。",
  "上传人应对其上传文件的合法性、安全性及相关授权情况负责，并依法承担因其上传行为所产生的相应责任。",
  "请确认文件无误后再继续上传。",
].join("\n\n");

export type LargeAttachmentAcknowledgementInput = {
  acknowledged: boolean;
  noticeVersion: string;
};

export function isValidLargeAttachmentAcknowledgement(
  input: LargeAttachmentAcknowledgementInput | null | undefined,
): boolean {
  return (
    input?.acknowledged === true &&
    input.noticeVersion === LARGE_ATTACHMENT_NOTICE_VERSION
  );
}
