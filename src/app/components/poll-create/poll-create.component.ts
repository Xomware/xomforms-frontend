import { Component, OnDestroy, OnInit } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { PollsService } from '../../services/polls.service';
import { CreatePollRequest, FieldType, FormField, GridBlock, Poll } from '../../models/poll.model';
import {
  EndTimeSummary,
  eventEndSummary,
  formatDuration,
  generateGrid,
  minutesToClockLabel,
  snapDurationToStep,
  snapMinutesToStep,
  viewerTimeZone,
} from '../../models/grid.util';
import { SelectOption } from '../styled-select/styled-select.component';

/** Preview caps how many days of the range it renders so it stays lightweight. */
const PREVIEW_MAX_DAYS = 3;

/** Longest event the backend accepts (MAX_EVENT_DURATION_MINUTES). */
const MAX_EVENT_DURATION_MINUTES = 360;

/**
 * The creator's "start interval": which start times responders are offered,
 * and therefore the resolution of the paint grid itself. Mirrors the backend's
 * ALLOWED_GRANULARITY_MINUTES. 30 is the default -- 15 is usually more
 * granularity than a group actually needs.
 */
interface GranularityChoice {
  value: number;
  label: string;
  hint: string;
}

const GRANULARITY_CHOICES: GranularityChoice[] = [
  { value: 60, label: 'On the hour', hint: '7:00, 8:00, 9:00' },
  { value: 30, label: 'Every 30 min', hint: '7:00, 7:30, 8:00' },
  { value: 15, label: 'Every 15 min', hint: '7:00, 7:15, 7:30' },
];

const DEFAULT_GRANULARITY_MINUTES = 30;

/**
 * The "close responses at" time-of-day list is deliberately INDEPENDENT of the
 * event's start interval — when a form stops accepting answers has nothing to
 * do with the resolution of its grid. Fixed 30-minute steps, defaulting to
 * 11:30 PM so picking just a date reads as "end of that day".
 */
const CLOSE_TIME_STEP_MINUTES = 30;
const DEFAULT_CLOSE_TIME_MINUTES = 23 * 60 + 30;

/** Buckets the ~48-96 entry time list into scannable headings. */
function timeOfDayGroup(minutes: number): string {
  if (minutes < 12 * 60) return 'Morning';
  if (minutes < 17 * 60) return 'Afternoon';
  if (minutes < 21 * 60) return 'Evening';
  return 'Late night';
}

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

  readonly granularityChoices = GRANULARITY_CHOICES;

  /**
   * Event length + start time options are REBUILT whenever the start interval
   * changes, so every offered value lands on the grid. The backend rejects a
   * start range or duration that isn't a multiple of granularityMinutes, so
   * these lists are the first line of that same rule.
   */
  durationOptions: SelectOption[] = [];
  timeOptions: SelectOption[] = [];

  /** Timezone picker: detected zone pinned, curated common zones, then all. */
  readonly timezoneOptions: SelectOption[] = this.buildTimezoneOptions();
  /** Fixed 30-minute list for the "close responses at" time. */
  readonly closeTimeOptions: SelectOption[] = this.buildTimeOptions(CLOSE_TIME_STEP_MINUTES);

  // ── Live preview state (recomputed as the time config changes) ──────
  previewBlocks: GridBlock[] = [];
  previewTruncated = false;
  previewDaysShown = 0;
  private valueSub?: Subscription;
  private granularitySub?: Subscription;

  readonly fieldTypeLabels = FIELD_TYPE_LABELS;
  readonly addableFieldTypes: FieldType[] = ['single_choice', 'multi_choice', 'dropdown', 'scale'];

  mode: CreateMode = 'picker';
  qaFields: BuilderField[] = [];

  submitting = false;
  errorMessage = '';

  constructor(
    private fb: FormBuilder,
    private pollsService: PollsService,
    private location: Location,
    private router: Router,
  ) {
    this.form = this.fb.group({
      title: ['', [Validators.required, Validators.maxLength(200)]],
      description: ['', [Validators.maxLength(2000)]],
      startDate: ['', Validators.required],
      endDate: ['', Validators.required],
      // Duration + start-range model: the creator sets an event length and the
      // range of allowed START times. The paint grid runs earliest ->
      // (latest + duration), stepped by the chosen start interval.
      eventDurationMinutes: [120, Validators.required],
      // Start times are held as MINUTES since midnight, not "HH:MM" strings --
      // the picker only offers on-grid values, so there's no free-text time to
      // parse and nothing to round-trip through a string.
      granularityMinutes: [DEFAULT_GRANULARITY_MINUTES, Validators.required],
      earliestStartMinute: [18 * 60, Validators.required],
      latestStartMinute: [21 * 60, Validators.required],
      timezone: [viewerTimeZone(), Validators.required],
      // "Anyone with the link can respond" is the default -- most polls are
      // shared openly; requiring an account is the exception.
      guestAllowed: [true],
      showResultsToRespondents: [false],
      // closeAt is split into a date + a time-of-day so both halves can use the
      // styled pickers. Recombined into one ISO instant at submit; a blank date
      // means "never closes", whatever the time says.
      closeAtDate: [''],
      closeAtTime: [DEFAULT_CLOSE_TIME_MINUTES],
    });
  }

  ngOnInit(): void {
    // Prime the interval-dependent option lists from the default granularity
    // before anything renders.
    this.rebuildIntervalOptions(this.granularityMinutes);

    // Keep the responder preview in sync with the time config.
    this.valueSub = this.form.valueChanges.subscribe(() => this.rebuildPreview());
    // Changing the start interval cascades into the other three time controls,
    // so it needs its own handler rather than riding the generic subscription.
    this.granularitySub = this.form
      .get('granularityMinutes')!
      .valueChanges.subscribe((step) => this.applyGranularity(Number(step)));

    this.rebuildPreview();
  }

  ngOnDestroy(): void {
    this.valueSub?.unsubscribe();
    this.granularitySub?.unsubscribe();
  }

  /**
   * Re-snap everything that depends on the start interval, in one pass.
   *
   * Widening the interval can strand already-picked values off the grid (18:15
   * is meaningless once starts are hourly), and the backend rejects any start
   * range or duration that isn't a multiple of granularityMinutes. So on every
   * change we rebuild the option lists and pull the current values onto the
   * nearest valid slot.
   *
   * The three setValue calls use `emitEvent: false` so they don't each retrigger
   * the generic valueChanges subscription (and, via it, three redundant preview
   * rebuilds); the preview is rebuilt once explicitly at the end instead.
   */
  private applyGranularity(step: number): void {
    if (!step) return;
    this.rebuildIntervalOptions(step);

    const earliest = this.form.get('earliestStartMinute');
    const latest = this.form.get('latestStartMinute');
    const duration = this.form.get('eventDurationMinutes');

    earliest?.setValue(snapMinutesToStep(Number(earliest.value) || 0, step), { emitEvent: false });
    latest?.setValue(snapMinutesToStep(Number(latest.value) || 0, step), { emitEvent: false });
    duration?.setValue(snapDurationToStep(Number(duration.value) || step, step), {
      emitEvent: false,
    });

    this.rebuildPreview();
  }

  private rebuildIntervalOptions(step: number): void {
    this.timeOptions = this.buildTimeOptions(step);
    this.durationOptions = this.buildDurationOptions(step);
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
    // Send the start-range shape; the backend derives + persists the grid
    // window (dayStart = earliest, dayEnd = latest + duration, granularity = 15).
    const req: CreatePollRequest = {
      title: value.title.trim(),
      description: value.description?.trim() || null,
      formType: 'scheduler',
      startDate: value.startDate,
      endDate: value.endDate,
      earliestStartMinute: Number(value.earliestStartMinute),
      latestStartMinute: Number(value.latestStartMinute),
      eventDurationMinutes: Number(value.eventDurationMinutes),
      // The creator's start interval IS the grid resolution.
      granularityMinutes: Number(value.granularityMinutes),
      timezone: value.timezone,
      guestAllowed: !!value.guestAllowed,
      showResultsToRespondents: !!value.showResultsToRespondents,
      closeAt: this.closeAtIso(),
    };

    this.pollsService.create(req).subscribe({
      next: (poll) => {
        this.submitting = false;
        this.goToCreatedForm(poll);
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
      closeAt: this.closeAtIso(),
    };

    this.pollsService.create(req).subscribe({
      next: (poll) => {
        this.submitting = false;
        this.goToCreatedForm(poll);
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

  /**
   * Hand off to the form's own page as soon as it exists.
   *
   * There used to be a bespoke "Poll created" screen here with its own share
   * box, an "add your availability" link out to the public page, and a copy of
   * the results. All three already live on /forms/<id> -- as the Admin tab, the
   * My picks tab, and Live results -- so the extra screen was a narrow,
   * duplicated version of a page we already have. Navigating straight there
   * also means the URL, the title, and the tabs are correct from the first
   * frame.
   */
  private goToCreatedForm(poll: Poll): void {
    this.router.navigate(['/forms', poll.pollId]);
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

  get granularityMinutes(): number {
    return Number(this.form.get('granularityMinutes')?.value) || DEFAULT_GRANULARITY_MINUTES;
  }

  get earliestStartMinutes(): number | null {
    const v = this.form.get('earliestStartMinute')?.value;
    return v == null || v === '' ? null : Number(v);
  }

  get latestStartMinutes(): number | null {
    const v = this.form.get('latestStartMinute')?.value;
    return v == null || v === '' ? null : Number(v);
  }

  get earliestStartLabel(): string {
    const start = this.earliestStartMinutes;
    return start == null ? '' : minutesToClockLabel(start);
  }

  /** Human-readable interval, for the preview summary line. */
  get granularityLabel(): string {
    const found = GRANULARITY_CHOICES.find((c) => c.value === this.granularityMinutes);
    return found ? found.label.toLowerCase() : `every ${this.granularityMinutes} min`;
  }

  setGranularity(step: number): void {
    this.form.get('granularityMinutes')?.setValue(step);
  }

  /** The end date can never precede the start date. */
  get endDateMin(): string | null {
    return this.form.get('startDate')?.value || null;
  }

  /**
   * Recombine the split close date + time-of-day into one UTC instant.
   * Returns null when no date is set — the time alone never closes a form.
   * Built via the local-time Date constructor (not string parsing) so the
   * instant is anchored to the creator's own clock.
   */
  private closeAtIso(): string | null {
    const dateStr: string = this.form.get('closeAtDate')?.value;
    if (!dateStr) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!match) return null;

    const minutes = Number(this.form.get('closeAtTime')?.value) || 0;
    const [, y, m, d] = match;
    const at = new Date(Number(y), Number(m) - 1, Number(d), Math.floor(minutes / 60), minutes % 60);
    return at.toISOString();
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

  /** Event lengths on the interval, e.g. hourly starts -> 1h, 2h, ... 6h. */
  private buildDurationOptions(step: number): SelectOption[] {
    const options: SelectOption[] = [];
    for (let m = step; m <= MAX_EVENT_DURATION_MINUTES; m += step) {
      options.push({ value: m, label: formatDuration(m) });
    }
    return options;
  }

  /** Every start time on the interval across a full day, grouped by daypart. */
  private buildTimeOptions(step: number): SelectOption[] {
    const options: SelectOption[] = [];
    for (let m = 0; m < 1440; m += step) {
      options.push({ value: m, label: minutesToClockLabel(m), group: timeOfDayGroup(m) });
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
      // The grid offers candidate START TIMES, so it stops one interval past
      // the latest allowed start -- NOT latest + duration, which would draw
      // rows for starts the creator never allowed. Mirrors the backend's
      // derivation exactly so the preview matches what responders get.
      dayEndMinute: latest + this.granularityMinutes,
      granularityMinutes: this.granularityMinutes,
      timezone,
    });

    const days = new Set(this.previewBlocks.map((b) => b.blockId.split('T')[0]));
    this.previewDaysShown = days.size;
  }

  private friendlyError(err: unknown): string {
    const httpErr = err as { error?: { error?: { message?: string } }; status?: number };
    const msg = httpErr?.error?.error?.message;
    if (msg) return msg;
    if (httpErr?.status === 401) return 'Your session expired -- please sign in again.';
    return 'Something went wrong. Please try again.';
  }
}
