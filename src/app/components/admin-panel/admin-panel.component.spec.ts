import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { AdminPanelComponent } from './admin-panel.component';
import { InvitesService } from '../../services/invites.service';
import { PollsService } from '../../services/polls.service';
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

  beforeEach(async () => {
    invites = jasmine.createSpyObj('InvitesService', ['send', 'list']);
    invites.list.and.returnValue(of({ pollId: 'p1', invites: [] }));
    polls = jasmine.createSpyObj('PollsService', ['update']);

    await TestBed.configureTestingModule({
      declarations: [AdminPanelComponent],
      imports: [FormsModule],
      providers: [
        { provide: InvitesService, useValue: invites },
        { provide: PollsService, useValue: polls },
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

  it('builds the public share link', () => {
    expect(component.shareUrl).toContain('/f/p1');
  });
});
