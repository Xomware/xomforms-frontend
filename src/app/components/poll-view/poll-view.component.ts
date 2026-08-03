import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { PollsService } from '../../services/polls.service';
import { ResponsesService } from '../../services/responses.service';
import { ResultsService, ResultsIdentity } from '../../services/results.service';
import { CognitoService } from '../../services/cognito.service';
import {
  Poll,
  GridBlock,
  FormField,
  ResultsVisibility,
  allowsResponseEdits,
  effectiveVisibility,
  isChoiceField,
  isQaPoll,
} from '../../models/poll.model';
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
  /** True once we know this respondent already has an answer on file. */
  hasResponded = false;
  /** Their existing answer, when editing rather than answering fresh. */
  editingExisting = false;
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
        this.loadExistingResponse();
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
      this.hasResponded = true;
      // Now that a response exists, an after_response form will let them
      // through the gate.
      if (this.resultsVisibility !== 'hidden') {
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

  /** Effective visibility, honouring the legacy boolean on older forms. */
  get resultsVisibility(): ResultsVisibility {
    return this.poll ? effectiveVisibility(this.poll) : 'hidden';
  }

  /** May this respondent change an answer they already submitted? */
  get canEditResponse(): boolean {
    return !!this.poll && allowsResponseEdits(this.poll) && this.state !== 'closed';
  }

  /** Why results aren't shown, when they aren't. */
  get resultsGateMessage(): string {
    if (this.resultsVisibility === 'hidden') {
      return 'The organizer has kept results private.';
    }
    if (this.resultsVisibility === 'after_response' && !this.hasResponded) {
      return "Fill out this form to see everyone's answers.";
    }
    return '';
  }

  get showResults(): boolean {
    return !this.resultsGateMessage;
  }

  /**
   * How this respondent proves to the public results route that they answered.
   * A guest presents their browser id; a signed-in respondent presents the
   * email they submitted under, since that route has no authorizer context.
   */
  private resultsIdentity(): ResultsIdentity {
    const guestId = this.responsesService.guestIdIfAny();
    if (!this.cognito.isAuthenticated() && guestId) return { guestId };
    return { email: this.cognito.currentUser?.email ?? null };
  }

  /**
   * Load this respondent's prior answer, if any, so the form opens pre-filled
   * and "edit your response" genuinely edits rather than starting from blank.
   * Best-effort: a failure just means they fill it in again.
   */
  private loadExistingResponse(): void {
    this.responsesService.myResponseFor(this.pollId).subscribe({
      next: (res) => {
        const existing = res?.response;
        if (!existing) return;
        this.hasResponded = true;
        this.editingExisting = true;
        if (existing.displayName) this.displayName = existing.displayName;
        if (existing.blocks?.length) this.selectedBlocks = [...existing.blocks];
        if (existing.answers) this.answers = { ...(existing.answers as Record<string, AnswerValue>) };
        // They've answered, so an after_response form should show results now.
        if (this.resultsVisibility !== 'hidden') this.startResultsPolling();
      },
      error: () => {
        /* no prior answer, or the lookup failed -- fall through to a blank form */
      },
    });
  }

  private startResultsPolling(): void {
    const identity = this.resultsIdentity();
    if (this.isQa) {
      this.resultsSub = this.resultsService.pollFormPublic(this.pollId, identity).subscribe({
        next: (result) => (this.formResult = result),
        error: () => {
          /* bonus view -- fail silently */
        },
      });
      return;
    }
    this.resultsSub = this.resultsService.pollPublic(this.pollId, identity).subscribe({
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
