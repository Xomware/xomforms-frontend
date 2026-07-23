import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { PollsService } from '../../services/polls.service';
import { ResponsesService } from '../../services/responses.service';
import { ResultsService } from '../../services/results.service';
import { CognitoService } from '../../services/cognito.service';
import { Poll, GridBlock, FormField, isChoiceField, isQaPoll } from '../../models/poll.model';
import { AnswerValue, FormResult, OverlapResult } from '../../models/response.model';
import { generateGrid, PollGridConfig } from '../../models/grid.util';

type ViewState = 'loading' | 'not-found' | 'closed' | 'needs-signin' | 'ready' | 'submitted' | 'error';

/**
 * Respondent landing: guest name entry (when guestAllowed) or authed
 * identity, availability grid, submit. GET /polls/get is public, so this
 * route itself is NOT behind authGuard -- the guestAllowed gate is
 * enforced server-side; this component only makes the UX branch
 * accordingly.
 */
@Component({
  selector: 'app-poll-view',
  templateUrl: './poll-view.component.html',
  styleUrls: ['./poll-view.component.scss'],
})
export class PollViewComponent implements OnInit, OnDestroy {
  state: ViewState = 'loading';
  poll: Poll | null = null;
  grid: GridBlock[] = [];
  selectedBlocks: string[] = [];
  displayName = '';
  submitting = false;
  errorMessage = '';

  // Q&A answer state (fieldId -> typed value).
  answers: Record<string, AnswerValue> = {};

  results: OverlapResult | null = null;
  formResult: FormResult | null = null;
  private resultsSub?: Subscription;

  private pollId = '';

  constructor(
    private route: ActivatedRoute,
    private pollsService: PollsService,
    private responsesService: ResponsesService,
    private resultsService: ResultsService,
    public cognito: CognitoService,
  ) {}

  ngOnInit(): void {
    this.pollId = this.route.snapshot.paramMap.get('pollId') ?? '';
    if (!this.pollId) {
      this.state = 'not-found';
      return;
    }
    this.loadPoll();
  }

  ngOnDestroy(): void {
    this.resultsSub?.unsubscribe();
  }

  private loadPoll(): void {
    this.pollsService.get(this.pollId).subscribe({
      next: (poll) => {
        this.poll = poll;
        // Only scheduler polls have a grid; a Q&A poll has none. A scheduler
        // poll always carries the grid scalars, so the cast is safe here.
        this.grid = isQaPoll(poll) ? [] : generateGrid(poll as PollGridConfig);

        if (poll.closeAt && new Date(poll.closeAt).getTime() < Date.now()) {
          this.state = 'closed';
          return;
        }
        if (!poll.guestAllowed && !this.cognito.isAuthenticated()) {
          this.state = 'needs-signin';
          return;
        }
        // For a signed-in respondent, seed a friendly display name from their
        // email's local-part (NOT the raw email) so the required field isn't
        // empty. A true guest is left blank -- no bogus email prefill.
        if (this.cognito.isAuthenticated() && !this.displayName) {
          const email = this.cognito.currentUser?.email ?? '';
          this.displayName = email.split('@')[0] ?? '';
        }
        this.state = 'ready';
      },
      error: (err) => {
        this.state = err?.status === 404 ? 'not-found' : 'error';
      },
    });
  }

  get signInUrl(): string {
    const next = encodeURIComponent(`/f/${this.pollId}`);
    return `/auth/sign-in?next=${next}`;
  }

  onSelectionChange(blocks: string[]): void {
    this.selectedBlocks = blocks;
  }

  // ── Q&A helpers ────────────────────────────────────────────────────
  get isQa(): boolean {
    return !!this.poll && isQaPoll(this.poll);
  }

  get fields(): FormField[] {
    return this.poll?.fields ?? [];
  }

  answerFor(fieldId: string): AnswerValue | null {
    return this.answers[fieldId] ?? null;
  }

  onAnswerChange(fieldId: string, value: AnswerValue): void {
    this.answers = { ...this.answers, [fieldId]: value };
  }

  private requiredFieldsAnswered(): boolean {
    return this.fields.every((f) => {
      if (!f.required) return true;
      const v = this.answers[f.fieldId];
      if (isChoiceField(f)) return Array.isArray(v) && v.length > 0;
      return typeof v === 'number';
    });
  }

  canSubmit(): boolean {
    if (this.displayName.trim().length === 0 || this.submitting) return false;
    if (this.isQa) return this.requiredFieldsAnswered();
    return true;
  }

  onSubmit(): void {
    if (!this.canSubmit() || !this.poll) return;

    this.submitting = true;
    this.errorMessage = '';

    const onSuccess = () => {
      this.submitting = false;
      this.state = 'submitted';
      if (this.poll?.showResultsToRespondents) {
        this.startResultsPolling();
      }
    };
    const onError = (err: unknown) => {
      this.submitting = false;
      this.errorMessage = this.friendlyError(err);
    };

    if (this.isQa) {
      this.responsesService
        .submitAnswers(this.poll.pollId, this.displayName.trim(), this.answers)
        .subscribe({ next: onSuccess, error: onError });
      return;
    }

    this.responsesService
      .submit(this.poll.pollId, this.displayName.trim(), this.selectedBlocks)
      .subscribe({ next: onSuccess, error: onError });
  }

  private startResultsPolling(): void {
    if (this.isQa) {
      this.resultsSub = this.resultsService.pollFormPublic(this.pollId).subscribe({
        next: (result) => (this.formResult = result),
        error: () => {
          /* bonus view -- fail silently */
        },
      });
      return;
    }
    this.resultsSub = this.resultsService.pollPublic(this.pollId).subscribe({
      next: (result) => (this.results = result),
      error: () => {
        /* results view is a bonus, not critical -- fail silently rather than
           blocking the "submitted" confirmation state. */
      },
    });
  }

  private friendlyError(err: unknown): string {
    const httpErr = err as { error?: { error?: { message?: string } }; status?: number };
    const msg = httpErr?.error?.error?.message;
    if (msg) return msg;
    if (httpErr?.status === 403) return 'This poll does not accept guest submissions -- please sign in.';
    return 'Something went wrong submitting your availability. Please try again.';
  }
}
