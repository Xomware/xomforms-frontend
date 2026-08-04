import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { PollsService } from '../../services/polls.service';
import { ResponsesService } from '../../services/responses.service';
import { InvitesService } from '../../services/invites.service';
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
  locationSummary,
} from '../../models/poll.model';
import { AnswerValue, FormResult, OverlapResult } from '../../models/response.model';
import { generateGrid, PollGridConfig, startRangeSummary } from '../../models/grid.util';
import {
  DayTurnout,
  bestTurnoutPercent,
  dayTurnout,
  deadSlotPercent,
  hasAnalytics,
  respondentCount,
  unanimousCount,
} from '../../models/analytics.util';

type ViewState = 'loading' | 'not-found' | 'closed' | 'needs-signin' | 'ready' | 'error';

/** Sections a respondent gets. Mirrors the creator's, minus Admin. */
export type RespondentTab = 'response' | 'results' | 'analytics' | 'admin';

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
  /**
   * Guests must leave an address: the organizer emails everyone once a time
   * is picked, and without one their answer is a vote that can never be told
   * the outcome. Signed-in respondents already have one on their token.
   */
  guestEmail = '';
  /** Only complain once they've actually left the field. */
  guestEmailTouched = false;
  /** The ?i= on an invite link, identifying who it was mailed to. */
  private inviteToken: string | null = null;
  /** True when the fields were filled from that invite rather than typed. */
  prefilledFromInvite = false;

  /**
   * Responding used to be a dead end -- a "thanks" screen with no way back to
   * your own answer. These are the same sections the creator gets, minus the
   * creator-only Admin tab.
   */
  tab: RespondentTab = 'response';
  /** Shows the success banner without stranding them on a terminal screen. */
  justSaved = false;
  formResult: FormResult | null = null;
  private resultsSub?: Subscription;

  private pollId = '';

  constructor(
    private route: ActivatedRoute,
    private pollsService: PollsService,
    private responsesService: ResponsesService,
    private resultsService: ResultsService,
    public cognito: CognitoService,
    private invitesService: InvitesService,
  ) {}

  ngOnInit(): void {
    this.pollId = this.route.snapshot.paramMap.get('pollId') ?? '';
    this.inviteToken = this.route.snapshot.queryParamMap.get('i');
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
        this.prefillFromInvite();
        this.loadExistingResponse();
        if (this.isCreator) this.startResultsPolling();
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
    if (this.needsGuestEmail && !this.guestEmailValid) return false;
    if (this.isQa) return this.requiredFieldsAnswered();
    return true;
  }

  onSubmit(): void {
    if (!this.canSubmit() || !this.poll) return;

    this.submitting = true;
    this.errorMessage = '';

    const onSuccess = () => {
      this.submitting = false;
      // Stay on the form rather than swapping to a terminal screen, so the
      // response remains visible and editable.
      this.state = 'ready';
      this.justSaved = true;
      this.editingExisting = true;
      this.hasResponded = true;
      // Now that a response exists, an after_response form will let them
      // through the gate.
      if (this.resultsVisibility !== 'hidden') {
        // Submitting is what unlocks an after_response form, so start polling
        // immediately -- the first tick fires straight away.
        this.resultsSub?.unsubscribe();
        this.startResultsPolling();
        // Answering is usually asked in order to SEE the answers, so land
        // them there rather than back on a form they just completed.
        this.tab = 'results';
      }
    };
    const onError = (err: unknown) => {
      this.submitting = false;
      this.errorMessage = this.friendlyError(err);
    };

    if (this.isQa) {
      this.responsesService
        .submitAnswers(this.poll.pollId, this.displayName.trim(), this.answers, this.emailForSubmit())
        .subscribe({ next: onSuccess, error: onError });
      return;
    }

    this.responsesService
      .submit(this.poll.pollId, this.displayName.trim(), this.selectedBlocks, this.emailForSubmit())
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
  /** Primary location line: venue, address, or "Online". Empty when unstated. */
  get locationLine(): string {
    return this.poll ? locationSummary(this.poll) : '';
  }

  /** The address, when a venue name is already carrying the main line. */
  get locationSub(): string {
    if (!this.poll || this.poll.locationType !== 'in_person') return '';
    const address = this.poll.locationAddress ?? '';
    return address && address !== this.locationLine ? address : '';
  }

  get isVirtual(): boolean {
    return this.poll?.locationType === 'virtual';
  }

  /** What the respondent is actually choosing, in plain language. */
  get pickingSummary(): string | null {
    return this.poll ? startRangeSummary(this.poll) : null;
  }

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
  /** Permissive on purpose -- this catches typos, the server is the authority. */
  get guestEmailValid(): boolean {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.guestEmail.trim());
  }

  get needsGuestEmail(): boolean {
    return !this.cognito.isAuthenticated();
  }

  get guestEmailError(): string {
    if (!this.needsGuestEmail) return '';
    // Nagging while someone is halfway through typing is noise; complain once
    // they've moved on, or once they've typed something clearly wrong.
    if (!this.guestEmailTouched) return '';
    if (!this.guestEmail.trim()) return 'Enter your email so you can be told the time.';
    return this.guestEmailValid ? '' : "That doesn't look like an email address.";
  }

  onGuestEmailBlur(): void {
    this.guestEmailTouched = true;
  }

  /**
   * Fill in whoever this invite was sent to.
   *
   * Runs before loadExistingResponse so a real prior answer still wins -- what
   * they actually submitted beats what we mailed. Signed-in visitors are
   * skipped: their own identity outranks whichever link they happened to open.
   */
  private prefillFromInvite(): void {
    if (!this.inviteToken || this.cognito.isAuthenticated()) return;
    this.invitesService.resolve(this.pollId, this.inviteToken).subscribe((recipient) => {
      if (!recipient?.email) return;
      // Never overwrite something they've already typed.
      if (!this.guestEmail.trim()) this.guestEmail = recipient.email;
      if (!this.displayName.trim() && recipient.name) this.displayName = recipient.name;
      this.prefilledFromInvite = true;
    });
  }

  /** Guests send what they typed; the server reads an authed caller's token. */
  private emailForSubmit(): string | undefined {
    return this.needsGuestEmail ? this.guestEmail.trim().toLowerCase() : undefined;
  }

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

  // ── Tabs ───────────────────────────────────────────────────────────
  /**
   * The creator opening their own share link is still the creator. This page
   * is reachable from "Open form" on the dashboard, so without an Admin tab
   * here the settings and invites appear to vanish depending on which link
   * you happened to click.
   */
  get isCreator(): boolean {
    const me = this.cognito.currentUser?.email;
    return !!me && !!this.poll && me === this.poll.creatorEmail;
  }

  /** Results and Analytics only exist once they're allowed to be seen. */
  get availableTabs(): RespondentTab[] {
    const tabs: RespondentTab[] = ['response'];
    // A creator always sees results on their own form, gate or no gate.
    if (this.showResults || this.isCreator) {
      tabs.push('results');
      if (!this.isQa) tabs.push('analytics');
    }
    if (this.isCreator) tabs.push('admin');
    return tabs;
  }

  tabLabel(tab: RespondentTab): string {
    if (tab === 'response') return 'Your response';
    if (tab === 'results') return 'Live results';
    return tab === 'analytics' ? 'Analytics' : 'Admin';
  }

  /** Keep the local copy in step after a settings or finalize change. */
  onPollUpdated(poll: Poll): void {
    this.poll = poll;
  }

  setTab(tab: RespondentTab): void {
    this.tab = tab;
    this.justSaved = false;
  }

  /** A guest has answered but has nowhere for it to live yet. */
  get canSaveToProfile(): boolean {
    return !this.cognito.isAuthenticated() && this.hasResponded;
  }

  // ── Analytics (same numbers the creator sees) ──────────────────────
  get hasAnalytics(): boolean {
    return !this.isQa && hasAnalytics(this.results);
  }

  get respondentCount(): number {
    return respondentCount(this.results);
  }

  get unanimousCount(): number {
    return unanimousCount(this.results);
  }

  get deadSlotPercent(): number {
    return deadSlotPercent(this.results);
  }

  get bestTurnoutPercent(): number {
    return bestTurnoutPercent(this.results);
  }

  get dayBreakdown(): DayTurnout[] {
    return dayTurnout(this.results);
  }

  private startResultsPolling(): void {
    // A creator reads their own results through the authed route: the public
    // one is gated by resultsVisibility, which would lock them out of their
    // own form when it's set to hidden.
    if (this.isCreator) {
      this.resultsSub = this.isQa
        ? this.resultsService.pollFormForCreator(this.pollId).subscribe({
            next: (r) => (this.formResult = r),
            error: () => {},
          })
        : this.resultsService.pollForCreator(this.pollId).subscribe({
            next: (r) => (this.results = r),
            error: () => {},
          });
      return;
    }

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
