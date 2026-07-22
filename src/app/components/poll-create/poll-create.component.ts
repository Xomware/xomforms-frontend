import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { PollsService } from '../../services/polls.service';
import { ResultsService } from '../../services/results.service';
import { CreatePollRequest, Poll } from '../../models/poll.model';
import { OverlapResult } from '../../models/response.model';
import { viewerTimeZone } from '../../models/grid.util';

/**
 * Creator form: title, date range, time window, granularity, tz,
 * guestAllowed, showResultsToRespondents, closeAt. Route-gated by
 * authGuard (Cognito sign-in required).
 *
 * After successful creation, shows the shareable poll link and the
 * creator's own live results view (polling results_get every ~10-15s via
 * ResultsService, rendered with the overlap-heatmap component) -- this is
 * the creator-facing counterpart to poll-view's respondent-facing flow,
 * kept inline here rather than as a 5th component since the plan named
 * exactly four.
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

  submitting = false;
  errorMessage = '';
  createdPoll: Poll | null = null;
  results: OverlapResult | null = null;
  resultsError = '';

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
      timezone: [viewerTimeZone(), Validators.required],
      guestAllowed: [false],
      showResultsToRespondents: [false],
      closeAt: [''],
    });
  }

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.resultsSub?.unsubscribe();
  }

  fieldInvalid(name: string): boolean {
    const ctrl = this.form.get(name);
    return !!ctrl && ctrl.invalid && (ctrl.dirty || ctrl.touched);
  }

  get shareUrl(): string {
    if (!this.createdPoll) return '';
    return `${window.location.origin}/f/${this.createdPoll.pollId}`;
  }

  copyShareLink(): void {
    if (!this.shareUrl) return;
    navigator.clipboard?.writeText(this.shareUrl).catch(() => {
      /* clipboard access denied -- non-fatal, the link is still visible/selectable */
    });
  }

  onSubmit(): void {
    if (this.form.invalid || this.submitting) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting = true;
    this.errorMessage = '';

    const value = this.form.value;
    const req: CreatePollRequest = {
      title: value.title.trim(),
      description: value.description?.trim() || null,
      startDate: value.startDate,
      endDate: value.endDate,
      dayStartMinute: this.timeToMinutes(value.dayStartTime),
      dayEndMinute: this.timeToMinutes(value.dayEndTime),
      granularityMinutes: Number(value.granularityMinutes),
      timezone: value.timezone,
      guestAllowed: !!value.guestAllowed,
      showResultsToRespondents: !!value.showResultsToRespondents,
      closeAt: value.closeAt ? new Date(value.closeAt).toISOString() : null,
    };

    this.pollsService.create(req).subscribe({
      next: (poll) => {
        this.submitting = false;
        this.createdPoll = poll;
        this.startResultsPolling(poll.pollId);
      },
      error: (err) => {
        this.submitting = false;
        this.errorMessage = this.friendlyError(err);
      },
    });
  }

  private startResultsPolling(pollId: string): void {
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
