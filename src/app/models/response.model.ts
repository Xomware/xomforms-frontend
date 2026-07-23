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

/**
 * A single field's answer on a Q&A form. Choice-type fields answer with a
 * list of optionIds (single-select is a one-element list, mirroring the
 * scheduler's blocks); scale answers with one integer.
 */
export type AnswerValue = string[] | number;

export interface SubmitAnswersRequest {
  pollId: string;
  displayName: string;
  answers: Record<string, AnswerValue>;
  /** Guest weak-identity, same semantics as SubmitAvailabilityRequest.guestId. */
  guestId?: string;
}

export interface SubmitAnswersResult {
  pollId: string;
  respondentKey: string;
  displayName: string;
  answers: Record<string, AnswerValue>;
}

/** One option's tally on a choice/dropdown field (mirrors BlockTally). */
export interface OptionTally {
  optionId: string;
  label: string;
  count: number;
  total: number;
  ratio: number;
}

/** One integer value's tally on a scale field (a histogram bucket). */
export interface ScaleBucket {
  value: number;
  count: number;
  total: number;
  ratio: number;
}

/** Per-field analytics from xomforms-backend's compute_form_results. */
export interface FieldResult {
  fieldId: string;
  type: string;
  label: string;
  totalResponses: number;
  options: OptionTally[];
  buckets: ScaleBucket[];
  mean?: number | null;
  min?: number | null;
  max?: number | null;
  scaleMin?: number | null;
  scaleMax?: number | null;
}

export interface FormResult {
  pollId: string;
  totalRespondents: number;
  fields: FieldResult[];
}

export interface OverlapResult {
  pollId: string;
  totalRespondents: number;
  blocks: BlockTally[];
  /** All blocks tied at the max count, chronological (earliest first). */
  bestBlockIds: string[];
  /**
   * Event-length window fields (additive -- may be absent when talking to a
   * backend deployed before this change; the heatmap guards for that).
   * eventDurationMinutes is the poll's configured event length; slotCount is
   * how many contiguous grid blocks it spans. bestWindowStartIds are the
   * start blockIds of the contiguous same-day window(s) where the most
   * respondents are free for the WHOLE window, bestWindowCount that headcount.
   */
  eventDurationMinutes?: number;
  slotCount?: number;
  bestWindowStartIds?: string[];
  bestWindowCount?: number;
}
