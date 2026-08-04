import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, Subscription, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { PollsService } from '../../services/polls.service';
import { ResponsesService } from '../../services/responses.service';
import {
  ClaimResult,
  Poll,
  PollStatus,
  RespondedForm,
  derivePollStatus,
} from '../../models/poll.model';

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

/** Which half of My Forms is showing: what you made, or what you answered. */
type SourceTab = 'created' | 'responded';

/** Which bulk action the confirm dialog is currently asking about. */
type PendingAction = { kind: 'delete' | 'close' | 'reopen'; pollIds: string[] } | null;

/** A poll plus its UI-derived, view-ready fields (status, formatted date). */
interface FormRow {
  poll: Poll;
  status: PollStatus;
  createdLabel: string;
}

/**
 * "My Forms" dashboard (route `/dashboard`, creator-only via authGuard).
 * Lists the signed-in creator's polls from the authed `polls_list` endpoint
 * (creatorEmail GSI), with client-side search/filter — the per-creator list
 * is small for MVP, so no server-side search path yet (see BRAINSTORM open
 * question #5). "Forms" is a label layer over the backend `poll` domain.
 */
@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  state: LoadState = 'loading';
  rows: FormRow[] = [];

  /** Forms the caller responded to. Read-only -- they aren't the creator. */
  sourceTab: SourceTab = 'created';
  respondedRows: RespondedForm[] = [];
  respondedState: LoadState = 'loading';

  /** Set when signing in just linked guest responses to this account. */
  claimNotice = '';
  private tabSub?: Subscription;

  search = '';
  statusFilter: 'all' | PollStatus = 'all';

  /** Selected pollIds for bulk actions. */
  selected = new Set<string>();
  /** pollId whose per-row action menu is open (only one at a time). */
  openMenuId: string | null = null;
  /** Non-null while the confirm dialog is up. */
  pending: PendingAction = null;
  busy = false;
  actionError = '';

  private readonly dateFmt = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  constructor(
    private pollsService: PollsService,
    private responsesService: ResponsesService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    // ?tab= makes each half of My Forms linkable, so the header can point at
    // them directly instead of always dropping you on "created".
    this.tabSub = this.route.queryParamMap.subscribe((params) => {
      const tab = params.get('tab');
      this.sourceTab = tab === 'responded' ? 'responded' : 'created';
    });
    this.load();
    this.loadResponded();
    this.claimGuestResponses();
  }

  /**
   * Link anything answered as a guest on this browser to the account.
   *
   * Runs on dashboard load rather than inside the auth callback so it also
   * catches a session that was already signed in when the guest responses
   * were made. It's idempotent server-side, so repeating it is free.
   */
  private claimGuestResponses(): void {
    this.responsesService.claimGuestResponses().subscribe({
      next: (result) => {
        if (!result) return;
        this.claimNotice = this.describeClaim(result);
        // Only re-read when something actually moved.
        if (result.claimed.length) this.loadResponded();
      },
      // Claiming is a convenience -- a failure must not break the dashboard.
      error: () => {},
    });
  }

  /**
   * Say what was linked rather than doing it silently: a guest id identifies a
   * browser, so the user is the only one who can tell whether these were
   * really theirs.
   */
  private describeClaim(result: ClaimResult): string {
    const n = result.claimed.length;
    if (!n) return '';
    const noun = n === 1 ? 'form you filled out' : 'forms you filled out';
    return `Linked ${n} ${noun} on this device to your account.`;
  }

  dismissClaimNotice(): void {
    this.claimNotice = '';
  }

  ngOnDestroy(): void {
    this.tabSub?.unsubscribe();
  }

  loadResponded(): void {
    this.respondedState = 'loading';
    this.responsesService.mine().subscribe({
      next: (res) => {
        this.respondedRows = res.responses ?? [];
        this.respondedState = this.respondedRows.length ? 'ready' : 'empty';
      },
      error: () => {
        this.respondedState = 'error';
      },
    });
  }

  /** Text search applies to both tabs; the status filter is creator-only. */
  get visibleResponded(): RespondedForm[] {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.respondedRows;
    return this.respondedRows.filter((r) => (r.title ?? '').toLowerCase().includes(q));
  }

  respondedStatus(row: RespondedForm): PollStatus {
    return derivePollStatus(row);
  }

  submittedLabel(row: RespondedForm): string {
    return row.submittedAt ? this.formatDate(row.submittedAt) : '—';
  }

  trackByRespondedId(_index: number, row: RespondedForm): string {
    return row.pollId;
  }

  /**
   * Switching tabs clears the selection. Bulk actions only exist on the
   * created tab, and carrying a selection across would leave the action bar
   * referring to rows that are no longer on screen.
   */
  setSourceTab(tab: SourceTab): void {
    if (this.sourceTab === tab) return;
    this.sourceTab = tab;
    this.selected.clear();
    this.openMenuId = null;
  }

  load(): void {
    this.state = 'loading';
    // A reload invalidates any selection -- stale ids must not survive into a
    // later bulk action.
    this.selected.clear();
    this.openMenuId = null;
    this.actionError = '';
    this.pollsService.list().subscribe({
      next: (res) => {
        const polls = [...(res.polls ?? [])].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        this.rows = polls.map((poll) => ({
          poll,
          status: derivePollStatus(poll),
          createdLabel: this.formatDate(poll.createdAt),
        }));
        this.state = this.rows.length ? 'ready' : 'empty';
      },
      error: () => {
        this.state = 'error';
      },
    });
  }

  /** Client-side text + status filter over the loaded rows. */
  get visibleRows(): FormRow[] {
    const q = this.search.trim().toLowerCase();
    return this.rows.filter((row) => {
      if (this.statusFilter !== 'all' && row.status !== this.statusFilter) {
        return false;
      }
      if (!q) return true;
      const haystack = `${row.poll.title} ${row.poll.description ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }

  get hasActiveFilter(): boolean {
    return this.search.trim().length > 0 || this.statusFilter !== 'all';
  }

  clearFilters(): void {
    this.search = '';
    this.statusFilter = 'all';
  }

  trackByPollId(_index: number, row: FormRow): string {
    return row.poll.pollId;
  }

  // ── Selection ─────────────────────────────────────────────────────
  isSelected(pollId: string): boolean {
    return this.selected.has(pollId);
  }

  toggleSelected(pollId: string): void {
    if (this.selected.has(pollId)) {
      this.selected.delete(pollId);
    } else {
      this.selected.add(pollId);
    }
  }

  /**
   * "Select all" means all VISIBLE rows, never the whole list -- selecting rows
   * hidden behind a filter and then bulk-deleting them is exactly the kind of
   * surprise that loses someone's data.
   */
  get allVisibleSelected(): boolean {
    const visible = this.visibleRows;
    return visible.length > 0 && visible.every((r) => this.selected.has(r.poll.pollId));
  }

  toggleSelectAllVisible(): void {
    const visible = this.visibleRows;
    if (this.allVisibleSelected) {
      for (const row of visible) this.selected.delete(row.poll.pollId);
    } else {
      for (const row of visible) this.selected.add(row.poll.pollId);
    }
  }

  clearSelection(): void {
    this.selected.clear();
  }

  get selectedCount(): number {
    return this.selected.size;
  }

  /** Selection is scoped to what's visible, so hidden rows never get acted on. */
  private get selectedVisibleIds(): string[] {
    return this.visibleRows
      .map((r) => r.poll.pollId)
      .filter((id) => this.selected.has(id));
  }

  // ── Per-row menu ──────────────────────────────────────────────────
  toggleMenu(pollId: string): void {
    this.openMenuId = this.openMenuId === pollId ? null : pollId;
  }

  closeMenu(): void {
    this.openMenuId = null;
  }

  // ── Action intents (all funnel through the confirm dialog) ────────
  askDelete(pollIds: string[]): void {
    if (!pollIds.length) return;
    this.closeMenu();
    this.actionError = '';
    this.pending = { kind: 'delete', pollIds };
  }

  askClose(pollIds: string[]): void {
    if (!pollIds.length) return;
    this.closeMenu();
    this.actionError = '';
    this.pending = { kind: 'close', pollIds };
  }

  askReopen(pollIds: string[]): void {
    if (!pollIds.length) return;
    this.closeMenu();
    this.actionError = '';
    this.pending = { kind: 'reopen', pollIds };
  }

  askDeleteSelected(): void {
    this.askDelete(this.selectedVisibleIds);
  }

  askCloseSelected(): void {
    this.askClose(this.selectedVisibleIds);
  }

  cancelPending(): void {
    this.pending = null;
  }

  get pendingTitle(): string {
    if (!this.pending) return '';
    const n = this.pending.pollIds.length;
    const noun = n === 1 ? 'form' : `${n} forms`;
    if (this.pending.kind === 'delete') return `Delete ${noun}?`;
    if (this.pending.kind === 'close') return `Close ${noun}?`;
    return `Reopen ${noun}?`;
  }

  get pendingBody(): string {
    if (!this.pending) return '';
    const n = this.pending.pollIds.length;
    const subject = n === 1 ? 'This form' : 'These forms';
    if (this.pending.kind === 'delete') {
      return `${subject} and every response submitted to ${
        n === 1 ? 'it' : 'them'
      } will be permanently deleted. This cannot be undone.`;
    }
    if (this.pending.kind === 'close') {
      return `${subject} will stop accepting new responses. Existing responses are kept, and you can reopen at any time.`;
    }
    return `${subject} will start accepting responses again.`;
  }

  get pendingConfirmLabel(): string {
    if (!this.pending) return '';
    if (this.pending.kind === 'delete') return 'Delete';
    return this.pending.kind === 'close' ? 'Close' : 'Reopen';
  }

  get pendingIsDestructive(): boolean {
    return this.pending?.kind === 'delete';
  }

  /**
   * Run the pending action across every selected poll in parallel.
   *
   * Each request swallows its own error into a per-id result so one failure
   * can't cancel the siblings; rows are only mutated locally for the ids that
   * actually succeeded, and any failure is surfaced rather than silently
   * leaving the UI out of sync with the server.
   */
  confirmPending(): void {
    if (!this.pending || this.busy) return;
    const { kind, pollIds } = this.pending;
    this.busy = true;
    this.actionError = '';

    const calls = pollIds.map((pollId) => {
      // Widened to unknown: the three calls resolve to different payloads and
      // only their success/failure matters here.
      const req: Observable<unknown> =
        kind === 'delete'
          ? this.pollsService.delete(pollId)
          : kind === 'close'
            ? this.pollsService.close(pollId)
            : this.pollsService.reopen(pollId);
      return req.pipe(
        map((res) => ({ pollId, ok: true, poll: res as Poll })),
        catchError(() => of({ pollId, ok: false, poll: null as Poll | null })),
      );
    });

    forkJoin(calls).subscribe((results) => {
      const succeeded = new Map(
        results.filter((r) => r.ok).map((r) => [r.pollId, r.poll] as const),
      );
      const failedCount = results.length - succeeded.size;

      if (kind === 'delete') {
        this.rows = this.rows.filter((r) => !succeeded.has(r.poll.pollId));
      } else {
        this.rows = this.rows.map((row) => {
          if (!succeeded.has(row.poll.pollId)) return row;
          // Take closeAt from the server's echo rather than stamping a local
          // clock: the backend decides the instant, and a client-generated
          // "now" isn't yet in the past, so derivePollStatus would still read
          // the row as open.
          const updated = succeeded.get(row.poll.pollId);
          const poll: Poll = { ...row.poll, closeAt: updated?.closeAt ?? null };
          return { ...row, poll, status: derivePollStatus(poll) };
        });
      }

      // Successful ids leave the selection; failed ones stay put so a retry
      // doesn't require reselecting them.
      for (const id of succeeded.keys()) this.selected.delete(id);

      if (failedCount > 0) {
        this.actionError =
          failedCount === results.length
            ? "That didn't work. Please try again."
            : `${failedCount} of ${results.length} forms couldn't be updated. They're still selected — try again.`;
      }

      this.busy = false;
      this.pending = null;
      if (this.rows.length === 0) this.state = 'empty';
    });
  }

  private formatDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : this.dateFmt.format(d);
  }
}
