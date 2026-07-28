import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { PollsService } from '../../services/polls.service';
import { ResultsService } from '../../services/results.service';
import { CreatePollRequest, FieldType, FormField, GridBlock, Poll } from '../../models/poll.model';
import { FormResult, OverlapResult } from '../../models/response.model';
import {
  EndTimeSummary,
  eventEndSummary,
  formatDuration,
  generateGrid,
  minutesToClockLabel,
  timeStringToMinutes,
  viewerTimeZone,
} from '../../models/grid.util';
import { SelectOption } from '../styled-select/styled-select.component';

/** Fixed grid resolution -- "block size" is no longer a user control. */
const GRID_GRANULARITY_MINUTES = 15;
/** Preview caps how many days of the range it renders so it stays lightweight. */
const PREVIEW_MAX_DAYS = 3;

/** A curated shortlist surfaced above the full ~400-entry IANA list. */
const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Australia/Sydney',
];

/**
 * The mode a creator is in. `picker` is the create-time starter chooser
 * (Blank / Scheduler / template placeholder). Choosing Scheduler drops into
 * the EXISTING, untouched scheduler form (`scheduler`). Choosing Blank opens
 * the Q&A field-list builder (`qa`).
 */
type CreateMode = 'picker' | 'scheduler' | 'qa';

/** In-builder representation of a field (flatter than the wire FormField). */
interface BuilderField {
  fieldId: string;
  type: FieldType;
  label: string;
  required: boolean;
  options: { optionId: string; label: string }[];
  min: number;
  max: number;
  minLabel: string;
  maxLabel: string;
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  single_choice: 'Multiple choice',
  multi_choice: 'Checkboxes',
  dropdown: 'Dropdown',
  scale: 'Linear scale',
};

/**
 * Creator flow. Starts on a starter picker; a scheduler poll uses the original
 * reactive form + availability results (unchanged), a Q&A form uses the field
 * builder + per-field tally results. After creation, shows the shareable link
 * and the creator's own live results view.
 */
@Component({
  selector: 'app-poll-create',
  templateUrl: './poll-create.component.html',
  styleUrls: ['./poll-create.component.scss'],
})
export class PollCreateComponent implements OnInit, OnDestroy {
  readonly form: FormGroup;

  /** Event length options: every 15 minutes from 15 up to 360 (6h). */
  readonly durationOptions: SelectOption[] = this.buildDurationOptions();
  /** Timezone picker: detected zone pinned, curated common zones, then all. */
  readonly timezoneOptions: SelectOption[] = this.buildTimezoneOptions();

  // ── Live preview state (recomputed as the time config changes) ──────
  previewBlocks: GridBlock[] = [];
  previewTruncated = false;
  previewDaysShown = 0;
  private valueSub?: Subscription;

  readonly fieldTypeLabels = FIELD_TYPE_LABELS;
  readonly addableFieldTypes: FieldType[] = ['single_choice', 'multi_choice', 'dropdown', 'scale'];

  mode: CreateMode = 'picker';
  qaFields: BuilderField[] = [];

  submitting = false;
  errorMessage = '';
  createdPoll: Poll | null = null;
  results: OverlapResult | null = null;
  formResult: FormResult | null = null;
  resultsError = '';
  addOwnAvailability = false;

  private resultsSub?: Subscription;

  constructor(
    private fb: FormBuilder,
    private pollsService: PollsService,
    private resultsService: ResultsService,
  ) {
    this.form = this.fb.group({
      title: ['', [Validators.required, Validators.maxLength(200)]],
      description: ['', [Validators.maxLength(2000)]],
      startDate: ['', Validators.required],
      endDate: ['', Validators.required],
      // Duration + start-range model: the creator sets an event length and the
      // range of allowed START times. The paint grid runs earliest ->
      // (latest + duration); "block size" is gone (fixed 15-min resolution).
      eventDurationMinutes: [120, Validators.required],
      earliestStartTime: ['18:00', Validators.required],
      latestStartTime: ['21:00', Validators.required],
      timezone: [viewerTimeZone(), Validators.required],
      // "Anyone with the link can respond" is the default -- most polls are
      // shared openly; requiring an account is the exception.
      guestAllowed: [true],
      showResultsToRespondents: [false],
      addOwnAvailability: [false],
      closeAt: [''],
    });
  }

  ngOnInit(): void {
    // Keep the responder preview in sync with the time config. startWith(null)
    // primes it from the initial defaults.
    this.valueSub = this.form.valueChanges.subscribe(() => this.rebuildPreview());
    this.rebuildPreview();
  }

  ngOnDestroy(): void {
    this.resultsSub?.unsubscribe();
    this.valueSub?.unsubscribe();
  }

  // ── Starter picker ────────────────────────────────────────────────
  chooseScheduler(): void {
    this.mode = 'scheduler';
  }

  chooseBlankForm(): void {
    this.mode = 'qa';
    if (this.qaFields.length === 0) this.addField('single_choice');
  }

  backToPicker(): void {
    this.mode = 'picker';
    this.errorMessage = '';
  }

  get isQa(): boolean {
    return this.mode === 'qa';
  }

  // ── Q&A field builder ─────────────────────────────────────────────
  addField(type: FieldType): void {
    const field: BuilderField = {
      fieldId: this.genId('f'),
      type,
      label: '',
      required: false,
      options:
        type === 'scale'
          ? []
          : [
              { optionId: this.genId('o'), label: 'Option 1' },
              { optionId: this.genId('o'), label: 'Option 2' },
            ],
      min: 1,
      max: 5,
      minLabel: '',
      maxLabel: '',
    };
    this.qaFields = [...this.qaFields, field];
  }

  removeField(index: number): void {
    this.qaFields = this.qaFields.filter((_, i) => i !== index);
  }

  moveField(index: number, dir: -1 | 1): void {
    const target = index + dir;
    if (target < 0 || target >= this.qaFields.length) return;
    const next = [...this.qaFields];
    [next[index], next[target]] = [next[target], next[index]];
    this.qaFields = next;
  }

  addOption(field: BuilderField): void {
    field.options = [
      ...field.options,
      { optionId: this.genId('o'), label: `Option ${field.options.length + 1}` },
    ];
  }

  removeOption(field: BuilderField, optIndex: number): void {
    field.options = field.options.filter((_, i) => i !== optIndex);
  }

  isChoice(field: BuilderField): boolean {
    return field.type !== 'scale';
  }

  /** True when the whole Q&A form is publishable (title + every field valid). */
  get qaFormValid(): boolean {
    if (this.form.get('title')?.invalid) return false;
    if (this.qaFields.length === 0) return false;
    return this.qaFields.every((f) => this.fieldValid(f));
  }

  fieldValid(field: BuilderField): boolean {
    if (!field.label.trim()) return false;
    if (this.isChoice(field)) {
      if (field.options.length < 2) return false;
      return field.options.every((o) => o.label.trim().length > 0);
    }
    return field.max > field.min;
  }

  // ── Shared derived state ──────────────────────────────────────────
  fieldInvalid(name: string): boolean {
    const ctrl = this.form.get(name);
    return !!ctrl && ctrl.invalid && (ctrl.dirty || ctrl.touched);
  }

  get shareUrl(): string {
    if (!this.createdPoll) return '';
    return `${window.location.origin}/f/${this.createdPoll.pollId}`;
  }

  /** The respond page for the creator to add their own availability. */
  get respondUrl(): string {
    return this.createdPoll ? `/f/${this.createdPoll.pollId}` : '';
  }

  get createdIsQa(): boolean {
    return this.createdPoll?.formType === 'qa';
  }

  copyShareLink(): void {
    if (!this.shareUrl) return;
    navigator.clipboard?.writeText(this.shareUrl).catch(() => {
      /* clipboard access denied -- non-fatal, the link is still visible/selectable */
    });
  }

  // ── Submit ────────────────────────────────────────────────────────
  onSubmit(): void {
    if (this.submitting) return;
    if (this.isQa) {
      this.submitQa();
      return;
    }
    this.submitScheduler();
  }

  private submitScheduler(): void {
    if (this.form.invalid || !this.startRangeValid) {
      this.form.markAllAsTouched();
      if (!this.startRangeValid) {
        this.errorMessage = 'Latest start must be at or after the earliest start.';
      }
      return;
    }

    this.submitting = true;
    this.errorMessage = '';

    const value = this.form.value;
    this.addOwnAvailability = !!value.addOwnAvailability;
    // Send the start-range shape; the backend derives + persists the grid
    // window (dayStart = earliest, dayEnd = latest + duration, granularity = 15).
    const req: CreatePollRequest = {
      title: value.title.trim(),
      description: value.description?.trim() || null,
      formType: 'scheduler',
      startDate: value.startDate,
      endDate: value.endDate,
      earliestStartMinute: this.timeToMinutes(value.earliestStartTime),
      latestStartMinute: this.timeToMinutes(value.latestStartTime),
      eventDurationMinutes: Number(value.eventDurationMinutes),
      timezone: value.timezone,
      guestAllowed: !!value.guestAllowed,
      showResultsToRespondents: !!value.showResultsToRespondents,
      closeAt: value.closeAt ? new Date(value.closeAt).toISOString() : null,
    };

    this.pollsService.create(req).subscribe({
      next: (poll) => {
        this.submitting = false;
        this.createdPoll = poll;
        this.startSchedulerResultsPolling(poll.pollId);
      },
      error: (err) => {
        this.submitting = false;
        this.errorMessage = this.friendlyError(err);
      },
    });
  }

  private submitQa(): void {
    if (!this.qaFormValid) {
      this.form.get('title')?.markAsTouched();
      return;
    }

    this.submitting = true;
    this.errorMessage = '';

    const value = this.form.value;
    const req: CreatePollRequest = {
      title: value.title.trim(),
      description: value.description?.trim() || null,
      formType: 'qa',
      fields: this.buildFields(),
      guestAllowed: !!value.guestAllowed,
      showResultsToRespondents: !!value.showResultsToRespondents,
      closeAt: value.closeAt ? new Date(value.closeAt).toISOString() : null,
    };

    this.pollsService.create(req).subscribe({
      next: (poll) => {
        this.submitting = false;
        this.createdPoll = poll;
        this.startFormResultsPolling(poll.pollId);
      },
      error: (err) => {
        this.submitting = false;
        this.errorMessage = this.friendlyError(err);
      },
    });
  }

  /** Convert the builder fields into the backend's typed FormField[]. */
  private buildFields(): FormField[] {
    return this.qaFields.map((f) => {
      if (f.type === 'scale') {
        return {
          fieldId: f.fieldId,
          type: 'scale',
          label: f.label.trim(),
          required: f.required,
          min: Number(f.min),
          max: Number(f.max),
          minLabel: f.minLabel.trim() || null,
          maxLabel: f.maxLabel.trim() || null,
        };
      }
      return {
        fieldId: f.fieldId,
        type: f.type,
        label: f.label.trim(),
        required: f.required,
        options: f.options.map((o) => ({ optionId: o.optionId, label: o.label.trim() })),
      };
    });
  }

  private startSchedulerResultsPolling(pollId: string): void {
    this.resultsSub = this.resultsService.pollForCreator(pollId).subscribe({
      next: (result) => {
        this.resultsError = '';
        this.results = result;
      },
      error: (err) => {
        this.resultsError = this.friendlyError(err);
      },
    });
  }

  private startFormResultsPolling(pollId: string): void {
    this.resultsSub = this.resultsService.pollFormForCreator(pollId).subscribe({
      next: (result) => {
        this.resultsError = '';
        this.formResult = result;
      },
      error: (err) => {
        this.resultsError = this.friendlyError(err);
      },
    });
  }

  private genId(prefix: string): string {
    const rand =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    return `${prefix}_${rand}`;
  }

  // ── Time config: derived state for the UI ──────────────────────────
  get durationMinutes(): number {
    return Number(this.form.get('eventDurationMinutes')?.value) || 0;
  }

  get durationLabel(): string {
    return this.durationMinutes ? formatDuration(this.durationMinutes) : '';
  }

  get earliestStartMinutes(): number | null {
    return timeStringToMinutes(this.form.get('earliestStartTime')?.value);
  }

  get latestStartMinutes(): number | null {
    return timeStringToMinutes(this.form.get('latestStartTime')?.value);
  }

  /** Latest start must be at or after earliest start. */
  get startRangeValid(): boolean {
    const e = this.earliestStartMinutes;
    const l = this.latestStartMinutes;
    if (e == null || l == null) return true; // required-validators handle blanks
    return l >= e;
  }

  /** When does the event END for the LATEST allowed start (with next-day note)? */
  get latestEndSummary(): EndTimeSummary | null {
    const start = this.latestStartMinutes;
    if (start == null || !this.durationMinutes) return null;
    return eventEndSummary(start, this.durationMinutes);
  }

  /** End time for the EARLIEST start (informational). */
  get earliestEndSummary(): EndTimeSummary | null {
    const start = this.earliestStartMinutes;
    if (start == null || !this.durationMinutes) return null;
    return eventEndSummary(start, this.durationMinutes);
  }

  get latestStartLabel(): string {
    const start = this.latestStartMinutes;
    return start == null ? '' : minutesToClockLabel(start);
  }

  get hasPreview(): boolean {
    return this.previewBlocks.length > 0;
  }

  private buildDurationOptions(): SelectOption[] {
    const options: SelectOption[] = [];
    for (let m = 15; m <= 360; m += 15) {
      options.push({ value: m, label: formatDuration(m) });
    }
    return options;
  }

  private buildTimezoneOptions(): SelectOption[] {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf
      ? Intl.supportedValuesOf('timeZone')
      : [];
    const detected = viewerTimeZone();
    const options: SelectOption[] = [];
    const seen = new Set<string>();

    const push = (tz: string, group: string) => {
      if (!tz || seen.has(tz)) return;
      seen.add(tz);
      options.push({ value: tz, label: tz.replace(/_/g, ' '), group });
    };

    push(detected, 'Your timezone');
    for (const tz of COMMON_TIMEZONES) push(tz, 'Common');
    for (const tz of all) push(tz, 'All timezones');
    // Fallback if the browser can't enumerate zones.
    if (options.length === 0) push(detected || 'UTC', 'Your timezone');
    return options;
  }

  /**
   * Rebuild the responder preview grid from the current time config. Renders at
   * most PREVIEW_MAX_DAYS days so a wide range stays lightweight; the derived
   * window (earliest -> latest + duration) matches exactly what a responder
   * gets, including an overnight roll past midnight.
   */
  private rebuildPreview(): void {
    const value = this.form.value;
    const startDate: string = value.startDate;
    const endDate: string = value.endDate;
    const earliest = this.earliestStartMinutes;
    const latest = this.latestStartMinutes;
    const duration = this.durationMinutes;
    const timezone: string = value.timezone;

    if (
      !startDate ||
      earliest == null ||
      latest == null ||
      !duration ||
      !timezone ||
      !this.startRangeValid
    ) {
      this.previewBlocks = [];
      this.previewTruncated = false;
      this.previewDaysShown = 0;
      return;
    }

    // Cap the preview to the first few days of the range.
    const start = new Date(`${startDate}T00:00:00`);
    const rangeEnd = endDate ? new Date(`${endDate}T00:00:00`) : start;
    const capEnd = new Date(start);
    capEnd.setDate(capEnd.getDate() + PREVIEW_MAX_DAYS - 1);
    const previewEnd = rangeEnd.getTime() < capEnd.getTime() ? rangeEnd : capEnd;
    this.previewTruncated = previewEnd.getTime() < rangeEnd.getTime();

    const pad2 = (n: number) => n.toString().padStart(2, '0');
    const previewEndStr = `${previewEnd.getFullYear()}-${pad2(previewEnd.getMonth() + 1)}-${pad2(
      previewEnd.getDate(),
    )}`;

    this.previewBlocks = generateGrid({
      startDate,
      endDate: previewEndStr,
      dayStartMinute: earliest,
      dayEndMinute: latest + duration,
      granularityMinutes: GRID_GRANULARITY_MINUTES,
      timezone,
    });

    const days = new Set(this.previewBlocks.map((b) => b.blockId.split('T')[0]));
    this.previewDaysShown = days.size;
  }

  private timeToMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  private friendlyError(err: unknown): string {
    const httpErr = err as { error?: { error?: { message?: string } }; status?: number };
    const msg = httpErr?.error?.error?.message;
    if (msg) return msg;
    if (httpErr?.status === 401) return 'Your session expired -- please sign in again.';
    return 'Something went wrong. Please try again.';
  }
}
