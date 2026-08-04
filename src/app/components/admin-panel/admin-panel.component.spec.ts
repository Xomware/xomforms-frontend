import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { AdminPanelComponent } from './admin-panel.component';
import { InvitesService } from '../../services/invites.service';
import { PollsService } from '../../services/polls.service';
import { ResponsesService } from '../../services/responses.service';
import { Poll } from '../../models/poll.model';

const POLL: Poll = {
  pollId: 'p1',
  creatorEmail: 'dom@example.com',
  title: 'Draft night',
  guestAllowed: true,
  showResultsToRespondents: false,
  createdAt: '2026-07-01T12:00:00Z',
};

describe('AdminPanelComponent', () => {
  let fixture: ComponentFixture<AdminPanelComponent>;
  let component: AdminPanelComponent;
  let invites: jasmine.SpyObj<InvitesService>;
  let polls: jasmine.SpyObj<PollsService>;
  let responses: jasmine.SpyObj<ResponsesService>;

  beforeEach(async () => {
    invites = jasmine.createSpyObj('InvitesService', ['send', 'list']);
    invites.list.and.returnValue(of({ pollId: 'p1', invites: [] }));
    polls = jasmine.createSpyObj('PollsService', ['update', 'finalize', 'icsUrl']);
    polls.icsUrl.and.returnValue('/polls/ics?pollId=p1');
    responses = jasmine.createSpyObj('ResponsesService', ['respondents']);
    responses.respondents.and.returnValue(of({ respondents: [] }));

    await TestBed.configureTestingModule({
      declarations: [AdminPanelComponent],
      imports: [FormsModule],
      providers: [
        { provide: InvitesService, useValue: invites },
        { provide: PollsService, useValue: polls },
        { provide: ResponsesService, useValue: responses },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminPanelComponent);
    component = fixture.componentInstance;
    component.poll = { ...POLL };
    fixture.detectChanges();
  });

  // ── Recipient parsing ─────────────────────────────────────────────
  it('accepts a list separated by commas, newlines, or spaces', () => {
    component.recipientsRaw = 'a@x.com, b@x.com\nc@x.com  d@x.com';
    expect(component.parsedRecipients).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
  });

  it('counts each address once regardless of case', () => {
    component.recipientsRaw = 'a@x.com, A@X.com';
    expect(component.recipientCount).toBe(1);
  });

  it('cannot send with an empty list', () => {
    component.recipientsRaw = '   ';
    expect(component.canSend).toBeFalse();
  });

  it('reports partial failures rather than claiming success', () => {
    // A batch that reads as "sent" when it wasn't is how people think they
    // invited someone they didn't.
    invites.send.and.returnValue(
      of({ pollId: 'p1', sent: 2, failed: 1, results: [] }),
    );
    component.recipientsRaw = 'a@x.com b@x.com c@x.com';
    component.sendInvites();

    expect(component.inviteSummary).toBe('Sent 2, 1 failed.');
  });

  it('clears the input after a successful send', () => {
    invites.send.and.returnValue(of({ pollId: 'p1', sent: 1, failed: 0, results: [] }));
    component.recipientsRaw = 'a@x.com';
    component.sendInvites();
    expect(component.recipientsRaw).toBe('');
  });

  it('keeps the input when the send fails outright', () => {
    invites.send.and.returnValue(throwError(() => ({ status: 500 })));
    component.recipientsRaw = 'a@x.com';
    component.sendInvites();

    expect(component.recipientsRaw).toBe('a@x.com');
    expect(component.inviteError).toBeTruthy();
  });

  // ── Settings ──────────────────────────────────────────────────────
  it('derives visibility from the legacy boolean on an older form', () => {
    component.poll = { ...POLL, showResultsToRespondents: true };
    expect(component.visibility).toBe('always');

    component.poll = { ...POLL, showResultsToRespondents: false };
    expect(component.visibility).toBe('hidden');
  });

  it('prefers the explicit setting over the legacy boolean', () => {
    component.poll = { ...POLL, resultsVisibility: 'after_response', showResultsToRespondents: true };
    expect(component.visibility).toBe('after_response');
  });

  it('treats a missing edit setting as edits allowed', () => {
    expect(component.editsAllowed).toBeTrue();
    component.poll = { ...POLL, allowResponseEdits: false };
    expect(component.editsAllowed).toBeFalse();
  });

  it('takes the server copy after saving a setting', () => {
    // Not a local patch: the backend also mirrors the legacy boolean, and
    // guessing at that here would let the two drift.
    const updated: Poll = { ...POLL, resultsVisibility: 'always', showResultsToRespondents: true };
    polls.update.and.returnValue(of(updated));

    component.setVisibility('always');

    expect(polls.update).toHaveBeenCalledWith('p1', { resultsVisibility: 'always' });
    expect(component.poll.showResultsToRespondents).toBeTrue();
  });

  it('does not re-save the visibility already in effect', () => {
    component.poll = { ...POLL, resultsVisibility: 'hidden' };
    component.setVisibility('hidden');
    expect(polls.update).not.toHaveBeenCalled();
  });

  it('surfaces a permission failure', () => {
    polls.update.and.returnValue(throwError(() => ({ status: 403 })));
    component.toggleEdits();
    expect(component.settingsError).toContain('creator');
  });

  // ── Instructions ──────────────────────────────────────────────────
  it('seeds the draft from the saved note', () => {
    component.poll = { ...POLL, instructions: 'Season commitment only.' };
    component.ngOnInit();
    expect(component.instructionsDraft).toBe('Season commitment only.');
    expect(component.instructionsDirty).toBeFalse();
  });

  it('only offers to save once the note actually changed', () => {
    component.instructionsDraft = '  ';
    expect(component.instructionsDirty).toBeFalse();
    component.instructionsDraft = 'Pick carefully';
    expect(component.instructionsDirty).toBeTrue();
  });

  it('saves the trimmed note', () => {
    polls.update.and.returnValue(of({ ...POLL, instructions: 'Pick carefully' }));
    component.instructionsDraft = '  Pick carefully  ';
    component.saveInstructions();

    expect(polls.update).toHaveBeenCalledWith('p1', { instructions: 'Pick carefully' });
    expect(component.instructionsDraft).toBe('Pick carefully');
  });

  it('does nothing when the note is unchanged', () => {
    component.saveInstructions();
    expect(polls.update).not.toHaveBeenCalled();
  });

  // ── Finalize ──────────────────────────────────────────────────────
  const withResults = () => {
    component.results = {
      pollId: 'p1',
      totalRespondents: 3,
      bestBlockIds: [],
      blocks: [
        { blockId: '2026-08-09T18:00', utcInstant: '', count: 3, total: 3, ratio: 1 },
        { blockId: '2026-08-09T18:30', utcInstant: '', count: 1, total: 3, ratio: 0.33 },
        { blockId: '2026-08-10T18:00', utcInstant: '', count: 0, total: 3, ratio: 0 },
      ],
    };
    component.ngOnChanges();
  };

  it('offers the best-supported slots first', () => {
    withResults();
    expect(component.finalizeOptions[0].blockId).toBe('2026-08-09T18:00');
    expect(component.finalizeOptions[0].count).toBe(3);
  });

  it('never offers a slot nobody can make', () => {
    withResults();
    // Confirming a time zero people are free for is not a decision anyone
    // wants to be one click away from.
    expect(component.finalizeOptions.some((o) => o.blockId === '2026-08-10T18:00')).toBeFalse();
  });

  it('preselects the best slot', () => {
    withResults();
    expect(component.chosenBlockId).toBe('2026-08-09T18:00');
  });

  it('asks before closing the form and mailing everyone', () => {
    withResults();
    component.askFinalize();
    expect(component.confirmingFinalize).toBeTrue();
    expect(polls.finalize).not.toHaveBeenCalled();
  });

  it('confirms and reports how many were notified', () => {
    withResults();
    polls.finalize.and.returnValue(
      of({
        pollId: 'p1',
        finalBlockId: '2026-08-09T18:00',
        startUtc: '2026-08-09T22:00:00Z',
        endUtc: '2026-08-10T01:00:00Z',
        notified: 3,
        failed: 0,
      }),
    );

    component.askFinalize();
    component.confirmFinalize(true);

    expect(polls.finalize).toHaveBeenCalledWith('p1', '2026-08-09T18:00', true);
    expect(component.finalizeSummary).toContain('3 notified');
    expect(component.isFinalized).toBeTrue();
  });

  it('surfaces partial notification failures rather than claiming success', () => {
    withResults();
    polls.finalize.and.returnValue(
      of({
        pollId: 'p1',
        finalBlockId: '2026-08-09T18:00',
        startUtc: '',
        endUtc: '',
        notified: 2,
        failed: 1,
      }),
    );

    component.askFinalize();
    component.confirmFinalize(true);
    expect(component.finalizeSummary).toContain('1 failed');
  });

  it('can correct a pick without emailing again', () => {
    withResults();
    polls.finalize.and.returnValue(
      of({ pollId: 'p1', finalBlockId: '2026-08-09T18:00', startUtc: '', endUtc: '', notified: 0, failed: 0 }),
    );

    component.confirmFinalize(false);

    expect(polls.finalize).toHaveBeenCalledWith('p1', '2026-08-09T18:00', false);
    expect(component.finalizeSummary).toContain('No emails sent');
  });

  it('counts who can actually be reached', () => {
    component.respondents = [
      { displayName: 'Sam', email: 'sam@x.com', isGuest: true, blockCount: 2 },
      { displayName: 'Alex', email: null, isGuest: true, blockCount: 1 },
    ];
    // The dialog states this number before closing the form, so it has to
    // exclude people with no address.
    expect(component.contactableCount).toBe(1);
  });

  it('builds the public share link', () => {
    expect(component.shareUrl).toContain('/f/p1');
  });
});
