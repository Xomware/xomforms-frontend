import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { PollsService } from '../../services/polls.service';
import { ResultsService } from '../../services/results.service';
import { CreatePollRequest, FieldType, FormField, Poll } from '../../models/poll.model';
import { FormResult, OverlapResult } from '../../models/response.model';
import { viewerTimeZone } from '../../models/grid.util';

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
  readonly granularityOptions = [15, 30, 60];
  readonly commonTimezones = Intl.supportedValuesOf
    ? Intl.supportedValuesOf('timeZone')
    : [viewerTimeZone()];

  readonly eventLengthOptions: { label: string; minutes: number | null }[] = [
    { label: 'One time slot (default)', minutes: null },
    { label: '30 minutes', minutes: 30 },
    { label: '1 hour', minutes: 60 },
    { label: '1.5 hours', minutes: 90 },
    { label: '2 hours', minutes: 120 },
    { label: '3 hours', minutes: 180 },
    { label: '4 hours', minutes: 240 },
    { label: '5 hours', minutes: 300 },
    { label: '6 hours', minutes: 360 },
  ];

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
      dayStartTime: ['08:00', Validators.required],
      dayEndTime: ['20:00', Validators.required],
      granularityMinutes: [30, Validators.required],
      eventDurationMinutes: [null],
      timezone: [viewerTimeZone(), Validators.required],
      // "Anyone with the link can respond" is the default -- most polls are
      // shared openly; requiring an account is the exception.
      guestAllowed: [true],
      showResultsToRespondents: [false],
      addOwnAvailability: [false],
      closeAt: [''],
    });
  }

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.resultsSub?.unsubscribe();
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
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting = true;
    this.errorMessage = '';

    const value = this.form.value;
    this.addOwnAvailability = !!value.addOwnAvailability;
    const eventDuration = value.eventDurationMinutes ? Number(value.eventDurationMinutes) : null;
    const req: CreatePollRequest = {
      title: value.title.trim(),
      description: value.description?.trim() || null,
      formType: 'scheduler',
      startDate: value.startDate,
      endDate: value.endDate,
      dayStartMinute: this.timeToMinutes(value.dayStartTime),
      dayEndMinute: this.timeToMinutes(value.dayEndTime),
      granularityMinutes: Number(value.granularityMinutes),
      eventDurationMinutes: eventDuration,
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
