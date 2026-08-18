type PublicPoolReasonDisplayProps = {
  poolReason: string | null;
  previousOwnerDisplayName?: string | null;
  previousOwnerLabel: string;
  previousOwnerUnknownLabel: string;
  reasonClassName?: string;
};

export function PublicPoolReasonDisplay({
  poolReason,
  previousOwnerDisplayName,
  previousOwnerLabel,
  previousOwnerUnknownLabel,
  reasonClassName = "text-sm crm-text [overflow-wrap:anywhere]",
}: PublicPoolReasonDisplayProps) {
  const trimmedReason = poolReason?.trim();
  const showPreviousOwner = previousOwnerDisplayName !== undefined;

  if (!trimmedReason && !showPreviousOwner) {
    return null;
  }

  return (
    <div className="space-y-1">
      {trimmedReason ? (
        <span className={`block ${reasonClassName}`}>{trimmedReason}</span>
      ) : null}
      {showPreviousOwner ? (
        <span className="block text-xs crm-text-secondary [overflow-wrap:anywhere]">
          {previousOwnerLabel}：
          {previousOwnerDisplayName ?? previousOwnerUnknownLabel}
        </span>
      ) : null}
    </div>
  );
}
