/**
 * Typed interfaces matching xomforms-backend's SubmitAvailabilityRequest,
 * BlockTally, and OverlapResult Pydantic models exactly.
 */

export interface SubmitAvailabilityRequest {
  pollId: string;
  displayName: string;
  blocks: string[]; // blockIds selected from the poll's grid
  /**
   * Guest weak-identity (name-only, no Cognito signup -- locked MVP
   * decision). Best-effort client-supplied uuid, persisted in
   * localStorage so a returning guest on the same browser upserts
   * instead of duplicating. Only used on the public submit route; the
   * authed route ignores it (respondentKey is the caller's email).
   */
  guestId?: string;
}

export interface SubmitAvailabilityResult {
  pollId: string;
  respondentKey: string;
  displayName: string;
  blocks: string[];
}

export interface BlockTally {
  blockId: string;
  utcInstant: string;
  count: number;
  total: number;
  ratio: number; // count / total, 0 when total === 0
}

export interface OverlapResult {
  pollId: string;
  totalRespondents: number;
  blocks: BlockTally[];
  /** All blocks tied at the max count, chronological (earliest first). */
  bestBlockIds: string[];
}
