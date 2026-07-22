import { Component, OnInit } from '@angular/core';
import { PollsService } from '../../services/polls.service';
import { Poll, PollStatus, derivePollStatus } from '../../models/poll.model';

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

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
export class DashboardComponent implements OnInit {
  state: LoadState = 'loading';
  rows: FormRow[] = [];
  search = '';
  statusFilter: 'all' | PollStatus = 'all';

  private readonly dateFmt = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  constructor(private pollsService: PollsService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.state = 'loading';
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

  private formatDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : this.dateFmt.format(d);
  }
}
