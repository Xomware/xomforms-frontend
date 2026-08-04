import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { PollsService } from '../../services/polls.service';
import { ResultsService } from '../../services/results.service';
import { ResponsesService } from '../../services/responses.service';
import { GridBlock, Poll, PollStatus, derivePollStatus, isQaPoll } from '../../models/poll.model';
import { AnswerValue, FormResult, OverlapResult } from '../../models/response.model';
import { generateGrid, startRangeSummary } from '../../models/grid.util';

/** Sections of a form, for its creator. */
export type FormTab = 'picks' | 'results' | 'analytics' | 'admin';

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

  /**
   * The form's own sections. "My picks" is first because the creator usually
   * wants to put their own availability in before anything else -- that used
   * to mean navigating away to the public respond page.
   */
  tab: FormTab = 'picks';

  // ── My picks (the creator answering their own form) ───────────────
  grid: GridBlock[] = [];
  myBlocks: string[] = [];
  myAnswers: Record<string, AnswerValue> = {};
  savingPicks = false;
  picksSaved = false;
  picksError = '';
  displayName = '';

  private pollId = '';
  private resultsSub?: Subscription;
  private copyTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private route: ActivatedRoute,
    private pollsService: PollsService,
    private resultsService: ResultsService,
    private responsesService: ResponsesService,
  ) {}

  /** Keep the local copy in step after a settings change. */
  onPollUpdated(poll: Poll): void {
    this.poll = poll;
    this.status = derivePollStatus(poll);
  }

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
        this.buildGrid(poll);
        this.loadMyPicks();
        this.startResultsPolling();
      },
      error: (err) => {
        this.state = err?.status === 404 ? 'not-found' : 'error';
      },
    });
  }

  /** The creator paints on the same grid respondents see. */
  private buildGrid(poll: Poll): void {
    if (this.isQa) return;
    if (
      !poll.startDate ||
      !poll.endDate ||
      poll.dayStartMinute == null ||
      poll.dayEndMinute == null ||
      !poll.granularityMinutes ||
      !poll.timezone
    ) {
      return;
    }
    this.grid = generateGrid({
      startDate: poll.startDate,
      endDate: poll.endDate,
      dayStartMinute: poll.dayStartMinute,
      dayEndMinute: poll.dayEndMinute,
      granularityMinutes: poll.granularityMinutes,
      timezone: poll.timezone,
    });
  }

  /** Prefill the creator's own prior answer, so this is an edit not a restart. */
  private loadMyPicks(): void {
    this.responsesService.myResponseFor(this.pollId).subscribe({
      next: (res) => {
        const mine = res?.response;
        if (!mine) return;
        if (mine.displayName) this.displayName = mine.displayName;
        if (mine.blocks?.length) this.myBlocks = [...mine.blocks];
        if (mine.answers) this.myAnswers = { ...(mine.answers as Record<string, AnswerValue>) };
      },
      error: () => {
        /* no prior answer -- start blank */
      },
    });
  }

  /** What the respondent is actually choosing, in plain language. */
  get pickingSummary(): string | null {
    return this.poll ? startRangeSummary(this.poll) : null;
  }

  onPicksChange(blocks: string[]): void {
    this.myBlocks = blocks;
    this.picksSaved = false;
  }

  get canSavePicks(): boolean {
    return !this.savingPicks && this.status === 'open';
  }

  /**
   * Save the creator's own availability in place. This used to require
   * following a link out to the public respond page and back.
   */
  savePicks(): void {
    if (!this.canSavePicks || !this.poll) return;
    this.savingPicks = true;
    this.picksError = '';
    this.picksSaved = false;

    const name = this.displayName.trim() || this.poll.creatorEmail.split('@')[0];
    const done = () => {
      this.savingPicks = false;
      this.picksSaved = true;
      // Pull results immediately instead of leaving the other tabs stale until
      // the next poll tick. Saving your own availability CHANGES the results,
      // so switching to them and seeing your answer missing reads as a bug --
      // which is exactly what a 12-second wait looks like.
      this.refreshResultsNow();
    };
    const fail = (err: unknown) => {
      this.savingPicks = false;
      this.picksError = this.friendlyError(err);
    };

    if (this.isQa) {
      this.responsesService
        .submitAnswers(this.pollId, name, this.myAnswers)
        .subscribe({ next: done, error: fail });
      return;
    }
    this.responsesService
      .submit(this.pollId, name, this.myBlocks)
      .subscribe({ next: done, error: fail });
  }

  /** One-shot refetch, separate from the interval subscription. */
  private refreshResultsNow(): void {
    if (this.isQa) {
      this.resultsService.getFormForCreator(this.pollId).subscribe({
        next: (result) => {
          this.resultsError = '';
          this.formResult = result;
        },
        error: () => {
          /* the interval poll will catch up -- don't surface a second error */
        },
      });
      return;
    }
    this.resultsService.getForCreator(this.pollId).subscribe({
      next: (result) => {
        this.resultsError = '';
        this.results = result;
      },
      error: () => {
        /* the interval poll will catch up */
      },
    });
  }

  // ── Analytics ──────────────────────────────────────────────────────
  get hasAnalytics(): boolean {
    return !this.isQa && !!this.results && this.results.totalRespondents > 0;
  }

  get respondentCount(): number {
    return this.results?.totalRespondents ?? 0;
  }

  /** Blocks where everyone is free -- the unambiguous wins. */
  get unanimousCount(): number {
    const total = this.respondentCount;
    if (!total || !this.results) return 0;
    return this.results.blocks.filter((b) => b.count === total).length;
  }

  /** Share of offered start times that nobody at all can make. */
  get deadSlotPercent(): number {
    const blocks = this.results?.blocks ?? [];
    if (!blocks.length) return 0;
    const dead = blocks.filter((b) => b.count === 0).length;
    return Math.round((dead / blocks.length) * 100);
  }

  /** Best headcount for a start time, as a fraction of everyone who answered. */
  get bestTurnoutPercent(): number {
    const total = this.respondentCount;
    if (!total || !this.results) return 0;
    const best = this.results.bestWindowCount ?? Math.max(...this.results.blocks.map((b) => b.count), 0);
    return Math.round((best / total) * 100);
  }

  /** Per-day availability, so a creator can see which days are worth keeping. */
  get dayBreakdown(): { date: string; label: string; best: number }[] {
    const blocks = this.results?.blocks ?? [];
    const byDay = new Map<string, number>();
    for (const block of blocks) {
      const date = block.blockId.split('T')[0];
      byDay.set(date, Math.max(byDay.get(date) ?? 0, block.count));
    }
    return Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, best]) => ({
        date,
        label: new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }),
        best,
      }));
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
