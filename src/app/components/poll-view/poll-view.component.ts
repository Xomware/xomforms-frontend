import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { PollsService } from '../../services/polls.service';
import { ResponsesService } from '../../services/responses.service';
import { ResultsService } from '../../services/results.service';
import { CognitoService } from '../../services/cognito.service';
import { Poll, GridBlock } from '../../models/poll.model';
import { OverlapResult } from '../../models/response.model';
import { generateGrid } from '../../models/grid.util';

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

  results: OverlapResult | null = null;
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
        this.grid = generateGrid(poll);

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

  canSubmit(): boolean {
    return this.displayName.trim().length > 0 && !this.submitting;
  }

  onSubmit(): void {
    if (!this.canSubmit() || !this.poll) return;

    this.submitting = true;
    this.errorMessage = '';

    this.responsesService.submit(this.poll.pollId, this.displayName.trim(), this.selectedBlocks).subscribe({
      next: () => {
        this.submitting = false;
        this.state = 'submitted';
        if (this.poll?.showResultsToRespondents) {
          this.startResultsPolling();
        }
      },
      error: (err) => {
        this.submitting = false;
        this.errorMessage = this.friendlyError(err);
      },
    });
  }

  private startResultsPolling(): void {
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
