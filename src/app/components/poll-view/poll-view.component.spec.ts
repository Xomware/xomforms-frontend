import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { PollViewComponent } from './poll-view.component';
import { PollsService } from '../../services/polls.service';
import { ResultsService } from '../../services/results.service';
import { ResponsesService } from '../../services/responses.service';
import { CognitoService } from '../../services/cognito.service';
import { Poll } from '../../models/poll.model';

const POLL: Poll = {
  pollId: 'p1',
  creatorEmail: 'creator@example.com',
  title: 'Draft Night',
  formType: 'scheduler',
  startDate: '2026-08-03',
  endDate: '2026-08-03',
  dayStartMinute: 1080,
  dayEndMinute: 1110,
  granularityMinutes: 30,
  timezone: 'America/New_York',
  guestAllowed: true,
  showResultsToRespondents: false,
  createdAt: '2026-07-01T12:00:00Z',
};

describe('PollViewComponent — guest email + creator access', () => {
  let fixture: ComponentFixture<PollViewComponent>;
  let component: PollViewComponent;
  let cognito: { isAuthenticated: jasmine.Spy; currentUser: { email: string } | null };

  beforeEach(async () => {
    const polls = jasmine.createSpyObj('PollsService', ['get']);
    polls.get.and.returnValue(of(POLL));
    const results = jasmine.createSpyObj('ResultsService', [
      'pollPublic',
      'pollFormPublic',
      'pollForCreator',
      'pollFormForCreator',
    ]);
    results.pollPublic.and.returnValue(of({}));
    results.pollForCreator.and.returnValue(of({}));
    const responses = jasmine.createSpyObj('ResponsesService', [
      'myResponseFor',
      'submit',
      'submitAnswers',
      'guestIdIfAny',
    ]);
    responses.myResponseFor.and.returnValue(of({ response: null }));
    responses.guestIdIfAny.and.returnValue(null);

    cognito = { isAuthenticated: jasmine.createSpy().and.returnValue(false), currentUser: null };

    await TestBed.configureTestingModule({
      declarations: [PollViewComponent],
      imports: [FormsModule],
      providers: [
        { provide: PollsService, useValue: polls },
        { provide: ResultsService, useValue: results },
        { provide: ResponsesService, useValue: responses },
        { provide: CognitoService, useValue: cognito },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ pollId: 'p1' }) } },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(PollViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ── Guest email ───────────────────────────────────────────────────
  it('stays quiet until the field has been left', () => {
    // Nagging while someone is halfway through typing is noise.
    component.guestEmail = 'dom';
    expect(component.guestEmailError).toBe('');
  });

  it('flags an address with no @ once blurred', () => {
    component.guestEmail = 'dom';
    component.onGuestEmailBlur();
    expect(component.guestEmailError).toContain("doesn't look like");
  });

  it('flags an empty address once blurred', () => {
    component.onGuestEmailBlur();
    expect(component.guestEmailError).toContain('Enter your email');
  });

  it('accepts a real-looking address', () => {
    component.guestEmail = 'dom@example.com';
    component.onGuestEmailBlur();
    expect(component.guestEmailError).toBe('');
    expect(component.guestEmailValid).toBeTrue();
  });

  it('blocks submitting without a valid guest email', () => {
    component.displayName = 'Dom';
    component.guestEmail = 'nope';
    expect(component.canSubmit()).toBeFalse();

    component.guestEmail = 'dom@example.com';
    expect(component.canSubmit()).toBeTrue();
  });

  it('does not ask a signed-in respondent for one', () => {
    cognito.isAuthenticated.and.returnValue(true);
    cognito.currentUser = { email: 'someone@example.com' };
    expect(component.needsGuestEmail).toBeFalse();

    component.displayName = 'Dom';
    // Their token already carries it.
    expect(component.canSubmit()).toBeTrue();
  });

  // ── Creator access ────────────────────────────────────────────────
  it('gives the creator an Admin tab on their own share link', () => {
    cognito.isAuthenticated.and.returnValue(true);
    cognito.currentUser = { email: 'creator@example.com' };
    component.ngOnInit();

    expect(component.isCreator).toBeTrue();
    expect(component.availableTabs).toContain('admin');
  });

  it('never shows Admin to a respondent', () => {
    cognito.isAuthenticated.and.returnValue(true);
    cognito.currentUser = { email: 'someone-else@example.com' };
    component.ngOnInit();

    expect(component.isCreator).toBeFalse();
    expect(component.availableTabs).not.toContain('admin');
  });

  it('never shows Admin to a signed-out visitor', () => {
    expect(component.isCreator).toBeFalse();
    expect(component.availableTabs).not.toContain('admin');
  });

  it('shows the creator results even when the gate would hide them', () => {
    // resultsVisibility is 'hidden' here; locking a creator out of their own
    // form's results would be absurd.
    cognito.isAuthenticated.and.returnValue(true);
    cognito.currentUser = { email: 'creator@example.com' };
    component.ngOnInit();

    expect(component.showResults).toBeFalse();
    expect(component.availableTabs).toContain('results');
  });
});
