import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { FormResultsComponent } from './form-results.component';
import { PollsService } from '../../services/polls.service';
import { ResultsService } from '../../services/results.service';
import { ResponsesService } from '../../services/responses.service';
import { Poll } from '../../models/poll.model';
import { OverlapResult } from '../../models/response.model';

const POLL: Poll = {
  pollId: 'p1',
  creatorEmail: 'dom@example.com',
  title: 'Draft night',
  formType: 'scheduler',
  startDate: '2026-08-03',
  endDate: '2026-08-04',
  dayStartMinute: 18 * 60,
  dayEndMinute: 19 * 60,
  granularityMinutes: 30,
  timezone: 'America/New_York',
  guestAllowed: true,
  showResultsToRespondents: false,
  createdAt: '2026-07-01T12:00:00Z',
};

const SUBMIT_OK = {
  pollId: 'p1',
  respondentKey: 'dom@example.com',
  displayName: 'Dom',
  blocks: [],
};

function overlap(partial: Partial<OverlapResult> = {}): OverlapResult {
  return {
    pollId: 'p1',
    totalRespondents: 4,
    blocks: [
      { blockId: '2026-08-03T18:00', utcInstant: '', count: 4, total: 4, ratio: 1 },
      { blockId: '2026-08-03T18:30', utcInstant: '', count: 2, total: 4, ratio: 0.5 },
      { blockId: '2026-08-04T18:00', utcInstant: '', count: 0, total: 4, ratio: 0 },
      { blockId: '2026-08-04T18:30', utcInstant: '', count: 1, total: 4, ratio: 0.25 },
    ],
    bestBlockIds: ['2026-08-03T18:00'],
    ...partial,
  };
}

describe('FormResultsComponent — tabs, picks, analytics', () => {
  let fixture: ComponentFixture<FormResultsComponent>;
  let component: FormResultsComponent;
  let polls: jasmine.SpyObj<PollsService>;
  let results: jasmine.SpyObj<ResultsService>;
  let responses: jasmine.SpyObj<ResponsesService>;

  beforeEach(async () => {
    polls = jasmine.createSpyObj('PollsService', ['get']);
    polls.get.and.returnValue(of(POLL));
    results = jasmine.createSpyObj('ResultsService', [
      'pollForCreator',
      'pollFormForCreator',
      'getForCreator',
      'getFormForCreator',
    ]);
    results.pollForCreator.and.returnValue(of(overlap()));
    results.pollFormForCreator.and.returnValue(of({ pollId: 'p1', totalRespondents: 0, fields: [] }));
    results.getForCreator.and.returnValue(of(overlap()));
    results.getFormForCreator.and.returnValue(of({ pollId: 'p1', totalRespondents: 0, fields: [] }));
    responses = jasmine.createSpyObj('ResponsesService', [
      'myResponseFor',
      'submit',
      'submitAnswers',
    ]);
    responses.myResponseFor.and.returnValue(of({ response: null }));

    await TestBed.configureTestingModule({
      declarations: [FormResultsComponent],
      imports: [FormsModule, RouterTestingModule],
      providers: [
        { provide: PollsService, useValue: polls },
        { provide: ResultsService, useValue: results },
        { provide: ResponsesService, useValue: responses },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'p1' }) } },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(FormResultsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('opens on My picks', () => {
    // Creators almost always want their own availability in first; that used
    // to mean navigating away to the public respond page.
    expect(component.tab).toBe('picks');
    expect(component.state).toBe('ready');
  });

  it('builds the paint grid from the poll config', () => {
    // 18:00-19:00 exclusive at 30-min steps, across two days.
    expect(component.grid.length).toBe(4);
    expect(component.grid[0].blockId).toBe('2026-08-03T18:00');
  });

  it('prefills the creator\'s existing answer so saving is an edit', () => {
    responses.myResponseFor.and.returnValue(
      of({ response: { pollId: 'p1', allowResponseEdits: true, displayName: 'Dom', blocks: ['2026-08-03T18:00'] } }),
    );
    component.ngOnInit();

    expect(component.displayName).toBe('Dom');
    expect(component.myBlocks).toEqual(['2026-08-03T18:00']);
  });

  it('saves availability in place', () => {
    responses.submit.and.returnValue(of(SUBMIT_OK));
    component.onPicksChange(['2026-08-03T18:00']);
    component.displayName = 'Dom';
    component.savePicks();

    expect(responses.submit).toHaveBeenCalledWith('p1', 'Dom', ['2026-08-03T18:00']);
    expect(component.picksSaved).toBeTrue();
  });

  it('falls back to the creator\'s email local-part for a name', () => {
    responses.submit.and.returnValue(of(SUBMIT_OK));
    component.savePicks();
    expect(responses.submit).toHaveBeenCalledWith('p1', 'dom', []);
  });

  it('surfaces a save failure and does not claim success', () => {
    responses.submit.and.returnValue(throwError(() => ({ status: 500 })));
    component.savePicks();
    expect(component.picksSaved).toBeFalse();
    expect(component.picksError).toBeTruthy();
  });

  it('blocks saving on a closed form', () => {
    component.status = 'closed';
    expect(component.canSavePicks).toBeFalse();
  });

  it('refreshes results immediately after saving, not on the next poll tick', () => {
    // Saving your own availability changes the results. Leaving the other tabs
    // stale for 12 seconds looks like the save didn't take.
    responses.submit.and.returnValue(of(SUBMIT_OK));
    results.getForCreator.calls.reset();

    component.savePicks();

    expect(results.getForCreator).toHaveBeenCalledWith('p1');
  });

  it('marks picks unsaved again after a change', () => {
    responses.submit.and.returnValue(of(SUBMIT_OK));
    component.savePicks();
    expect(component.picksSaved).toBeTrue();
    component.onPicksChange(['2026-08-03T18:30']);
    expect(component.picksSaved).toBeFalse();
  });

  // ── Analytics ─────────────────────────────────────────────────────
  it('reports respondents and best turnout', () => {
    expect(component.hasAnalytics).toBeTrue();
    expect(component.respondentCount).toBe(4);
    // 4 of 4 free at the best block.
    expect(component.bestTurnoutPercent).toBe(100);
  });

  it('counts times everyone is free', () => {
    expect(component.unanimousCount).toBe(1);
  });

  it('reports the share of times nobody can make', () => {
    // 1 of 4 blocks has a zero count.
    expect(component.deadSlotPercent).toBe(25);
  });

  it('breaks the best turnout down by day', () => {
    const days = component.dayBreakdown;
    expect(days.length).toBe(2);
    expect(days[0].best).toBe(4);
    expect(days[1].best).toBe(1);
  });

  it('has no analytics before anyone responds', () => {
    results.pollForCreator.and.returnValue(of(overlap({ totalRespondents: 0, blocks: [] })));
    component.ngOnInit();
    expect(component.hasAnalytics).toBeFalse();
  });

  it('does not divide by zero with no respondents', () => {
    results.pollForCreator.and.returnValue(of(overlap({ totalRespondents: 0, blocks: [] })));
    component.ngOnInit();
    expect(component.bestTurnoutPercent).toBe(0);
    expect(component.deadSlotPercent).toBe(0);
    expect(component.unanimousCount).toBe(0);
  });
});
