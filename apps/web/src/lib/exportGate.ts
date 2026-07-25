/**
 * Pure gate for the Instantly export confirmation button. Blocked leads are
 * never uploaded regardless of this check (the upload always reads
 * ready_to_push.csv, which already excludes them) — this only decides
 * whether the user has explicitly acknowledged that exclusion when leads
 * were in fact blocked, per the fail-closed requirement: a blocked-and-
 * unacknowledged run must not silently look confirmable.
 */
export function canConfirmInstantlyUpload(input: {
  confirmTitle: string;
  campaignTitle: string;
  confirmCount: string;
  readyCount: number | null;
  listId: string;
  blockedRowsCount: number;
  partialAcknowledged: boolean;
}): boolean {
  const {
    confirmTitle,
    campaignTitle,
    confirmCount,
    readyCount,
    listId,
    blockedRowsCount,
    partialAcknowledged,
  } = input;
  if (confirmTitle.trim() !== campaignTitle.trim()) return false;
  if (Number(confirmCount) !== (readyCount ?? -1)) return false;
  if (listId.trim().length === 0) return false;
  if (blockedRowsCount > 0 && !partialAcknowledged) return false;
  return true;
}
