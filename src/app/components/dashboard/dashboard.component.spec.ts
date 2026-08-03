import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { DashboardComponent } from './dashboard.component';
import { PollsService } from '../../services/polls.service';
import { ResponsesService } from '../../services/responses.service';
import { Poll } from '../../models/poll.model';

function makePoll(pollId: string, title: string, closeAt: string | null = null): Poll {
  return {
    pollId,
    creatorEmail: 'dom@example.com',
    title,
    guestAllowed: true,
    showResultsToRespondents: false,
    closeAt,
    createdAt: '2026-07-01T12:00:00Z',
    timezone: 'America/New_York',
  };
}

describe('DashboardComponent — close/delete', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let component: DashboardComponent;
  let pollsService: jasmine.SpyObj<PollsService>;
  let responsesService: jasmine.SpyObj<ResponsesService>;

  const polls = [
    makePoll('p1', 'Draft night'),
    makePoll('p2', 'Team sync'),
    // Already closed (closeAt in the past).
    makePoll('p3', 'Old poll', '2026-01-01T00:00:00Z'),
  ];

  beforeEach(async () => {
    pollsService = jasmine.createSpyObj('PollsService', ['list', 'delete', 'close', 'reopen']);
    pollsService.list.and.returnValue(of({ polls }));

    responsesService = jasmine.createSpyObj('ResponsesService', ['mine', 'claimGuestResponses']);
    responsesService.mine.and.returnValue(of({ responses: [] }));
    responsesService.claimGuestResponses.and.returnValue(of(null));

    await TestBed.configureTestingModule({
      declarations: [DashboardComponent],
      imports: [FormsModule, RouterTestingModule],
      providers: [
        { provide: PollsService, useValue: pollsService },
        { provide: ResponsesService, useValue: responsesService },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads and derives status per row', () => {
    expect(component.state).toBe('ready');
    expect(component.rows.length).toBe(3);
    expect(component.rows.find((r) => r.poll.pollId === 'p3')?.status).toBe('closed');
  });

  // ── Selection scoping ─────────────────────────────────────────────
  it('select-all covers only the rows currently visible', () => {
    component.statusFilter = 'closed';
    component.toggleSelectAllVisible();

    expect(component.selectedCount).toBe(1);
    expect(component.isSelected('p3')).toBeTrue();
    expect(component.isSelected('p1')).toBeFalse();
  });

  it('never acts on a selected row that a filter has since hidden', () => {
    component.toggleSelected('p1');
    component.toggleSelected('p3');
    // Narrow to closed -- p1 is now hidden but still in the selection set.
    component.statusFilter = 'closed';

    component.askDeleteSelected();

    expect(component.pending?.pollIds).toEqual(['p3']);
  });

  it('allVisibleSelected tracks the filtered subset', () => {
    component.statusFilter = 'open';
    expect(component.allVisibleSelected).toBeFalse();
    component.toggleSelected('p1');
    component.toggleSelected('p2');
    expect(component.allVisibleSelected).toBeTrue();
  });

  // ── Confirm gating ────────────────────────────────────────────────
  it('routes delete through a confirm dialog rather than acting immediately', () => {
    component.askDelete(['p1']);
    expect(component.pending).toEqual({ kind: 'delete', pollIds: ['p1'] });
    expect(pollsService.delete).not.toHaveBeenCalled();
  });

  it('warns that responses are destroyed too', () => {
    component.askDelete(['p1']);
    expect(component.pendingBody).toContain('every response');
    expect(component.pendingBody).toContain('cannot be undone');
    expect(component.pendingIsDestructive).toBeTrue();
  });

  it('cancelling leaves everything untouched', () => {
    component.askDelete(['p1']);
    component.cancelPending();
    expect(component.pending).toBeNull();
    expect(pollsService.delete).not.toHaveBeenCalled();
    expect(component.rows.length).toBe(3);
  });

  // ── Delete ────────────────────────────────────────────────────────
  it('removes deleted rows and clears them from the selection', () => {
    pollsService.delete.and.returnValue(of({ pollId: 'p1', deletedResponses: 2 }));
    component.toggleSelected('p1');

    component.askDeleteSelected();
    component.confirmPending();

    expect(pollsService.delete).toHaveBeenCalledWith('p1');
    expect(component.rows.map((r) => r.poll.pollId)).toEqual(['p2', 'p3']);
    expect(component.selectedCount).toBe(0);
    expect(component.actionError).toBe('');
  });

  it('drops to the empty state once the last form is deleted', () => {
    pollsService.delete.and.returnValue(of({ pollId: 'x', deletedResponses: 0 }));
    component.askDelete(['p1', 'p2', 'p3']);
    component.confirmPending();

    expect(component.rows.length).toBe(0);
    expect(component.state).toBe('empty');
  });

  it('keeps failed rows and reports a partial failure', () => {
    pollsService.delete.and.callFake((pollId: string) =>
      pollId === 'p2' ? throwError(() => new Error('boom')) : of({ pollId, deletedResponses: 0 }),
    );
    component.toggleSelected('p1');
    component.toggleSelected('p2');

    component.askDeleteSelected();
    component.confirmPending();

    // p1 succeeded and is gone; p2 failed, survives, and stays selected for retry.
    expect(component.rows.map((r) => r.poll.pollId)).toEqual(['p2', 'p3']);
    expect(component.isSelected('p2')).toBeTrue();
    expect(component.selectedCount).toBe(1);
    expect(component.actionError).toContain('1 of 2');
  });

  it('reports a total failure without mutating any row', () => {
    pollsService.delete.and.returnValue(throwError(() => new Error('nope')));
    component.askDelete(['p1']);
    component.confirmPending();

    expect(component.rows.length).toBe(3);
    expect(component.actionError).toBe("That didn't work. Please try again.");
  });

  // ── Close / reopen ────────────────────────────────────────────────
  it('closing flips status to closed without dropping the row', () => {
    pollsService.close.and.returnValue(of(makePoll('p1', 'Draft night', '2026-08-03T00:00:00Z')));
    component.askClose(['p1']);
    component.confirmPending();

    expect(pollsService.close).toHaveBeenCalledWith('p1');
    expect(component.rows.length).toBe(3);
    expect(component.rows.find((r) => r.poll.pollId === 'p1')?.status).toBe('closed');
  });

  it('reopening clears closeAt and returns the row to open', () => {
    pollsService.reopen.and.returnValue(of(makePoll('p3', 'Old poll', null)));
    component.askReopen(['p3']);
    component.confirmPending();

    expect(pollsService.reopen).toHaveBeenCalledWith('p3');
    expect(component.rows.find((r) => r.poll.pollId === 'p3')?.status).toBe('open');
  });

  it('says closing preserves existing responses', () => {
    component.askClose(['p1']);
    expect(component.pendingBody).toContain('Existing responses are kept');
    expect(component.pendingIsDestructive).toBeFalse();
  });

  it('ignores an action with nothing selected', () => {
    component.askDeleteSelected();
    expect(component.pending).toBeNull();
  });

  // ── Responded tab ─────────────────────────────────────────────────
  it('loads the forms the caller filled out', () => {
    expect(responsesService.mine).toHaveBeenCalled();
    expect(component.respondedState).toBe('empty');
  });

  it('switching tabs clears the selection', () => {
    component.toggleSelected('p1');
    component.setSourceTab('responded');
    expect(component.selectedCount).toBe(0);
    expect(component.sourceTab).toBe('responded');
  });

  it('search filters the responded list too', () => {
    component.respondedRows = [
      { pollId: 'r1', title: 'Book club', allowResponseEdits: true },
      { pollId: 'r2', title: 'Standup', allowResponseEdits: false },
    ];
    component.search = 'book';
    expect(component.visibleResponded.map((r) => r.pollId)).toEqual(['r1']);
  });

  it('tells the user when guest responses were linked', () => {
    responsesService.claimGuestResponses.and.returnValue(
      of({ claimed: ['p9'], skippedExisting: [], skippedStale: [], windowHours: 24 }),
    );
    component.ngOnInit();
    // Linking someone's answers must be visible, not silent -- a guest id is a
    // browser, so only the user can tell whether they were really theirs.
    expect(component.claimNotice).toContain('1 form you filled out');
  });

  it('says nothing when there was nothing to claim', () => {
    responsesService.claimGuestResponses.and.returnValue(
      of({ claimed: [], skippedExisting: [], skippedStale: ['old'], windowHours: 24 }),
    );
    component.ngOnInit();
    expect(component.claimNotice).toBe('');
  });

  it('a failed claim does not break the dashboard', () => {
    responsesService.claimGuestResponses.and.returnValue(throwError(() => new Error('nope')));
    component.ngOnInit();
    expect(component.state).toBe('ready');
  });

  it('a reload clears any stale selection', () => {
    component.toggleSelected('p1');
    component.load();
    expect(component.selectedCount).toBe(0);
  });
});
