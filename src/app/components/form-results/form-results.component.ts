import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { PollsService } from '../../services/polls.service';
import { ResultsService } from '../../services/results.service';
import { Poll, PollStatus, derivePollStatus, isQaPoll } from '../../models/poll.model';
import { FormResult, OverlapResult } from '../../models/response.model';

type ViewState = 'loading' | 'not-found' | 'error' | 'ready';

/**
 * Creator-facing results view (route `/forms/:id`, authGuard). The dashboard
 * "View results" link lands here for an EXISTING form — previously the live
 * results heatmap was only reachable inline right after creating a poll.
 *
 * This is a thin container: it loads the poll (title/status/share link) and
 * REUSES the existing `ResultsService.pollForCreator` (authed, creator-only
 * `results_get`, 12s polling) + `<app-overlap-heatmap>` component as-is. No
 * results/heatmap logic is rebuilt here.
 */
@Component({
  selector: 'app-form-results',
  templateUrl: './form-results.component.html',
  styleUrls: ['./form-results.component.scss'],
})
export class FormResultsComponent implements OnInit, OnDestroy {
  state: ViewState = 'loading';
  poll: Poll | null = null;
  status: PollStatus = 'open';
  results: OverlapResult | null = null;
  formResult: FormResult | null = null;
  isQa = false;
  resultsError = '';
  copied = false;

  private pollId = '';
  private resultsSub?: Subscription;
  private copyTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private route: ActivatedRoute,
    private pollsService: PollsService,
    private resultsService: ResultsService,
  ) {}

  ngOnInit(): void {
    this.pollId = this.route.snapshot.paramMap.get('id') ?? '';
    if (!this.pollId) {
      this.state = 'not-found';
      return;
    }
    this.loadPoll();
  }

  ngOnDestroy(): void {
    this.resultsSub?.unsubscribe();
    if (this.copyTimer) clearTimeout(this.copyTimer);
  }

  get shareUrl(): string {
    return this.pollId ? `${window.location.origin}/f/${this.pollId}` : '';
  }

  copyShareLink(): void {
    if (!this.shareUrl) return;
    navigator.clipboard
      ?.writeText(this.shareUrl)
      .then(() => {
        this.copied = true;
        if (this.copyTimer) clearTimeout(this.copyTimer);
        this.copyTimer = setTimeout(() => (this.copied = false), 2000);
      })
      .catch(() => {
        /* clipboard denied — link stays visible/selectable in the field */
      });
  }

  private loadPoll(): void {
    this.pollsService.get(this.pollId).subscribe({
      next: (poll) => {
        this.poll = poll;
        this.isQa = isQaPoll(poll);
        this.status = derivePollStatus(poll);
        this.state = 'ready';
        this.startResultsPolling();
      },
      error: (err) => {
        this.state = err?.status === 404 ? 'not-found' : 'error';
      },
    });
  }

  private startResultsPolling(): void {
    if (this.isQa) {
      this.resultsSub = this.resultsService.pollFormForCreator(this.pollId).subscribe({
        next: (result) => {
          this.resultsError = '';
          this.formResult = result;
        },
        error: (err) => {
          this.resultsError = this.friendlyError(err);
        },
      });
      return;
    }
    this.resultsSub = this.resultsService.pollForCreator(this.pollId).subscribe({
      next: (result) => {
        this.resultsError = '';
        this.results = result;
      },
      error: (err) => {
        this.resultsError = this.friendlyError(err);
      },
    });
  }

  private friendlyError(err: unknown): string {
    const httpErr = err as { error?: { error?: { message?: string } }; status?: number };
    const msg = httpErr?.error?.error?.message;
    if (msg) return msg;
    if (httpErr?.status === 401) return 'Your session expired — please sign in again.';
    if (httpErr?.status === 403) return "You don't have access to this form's results.";
    return 'Could not load results right now. Retrying…';
  }
}
