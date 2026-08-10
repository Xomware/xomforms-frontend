import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { AvailabilityGridComponent } from './availability-grid.component';
import { GridBlock } from '../../models/poll.model';

/** Aug 2026: 3rd is a Monday, 8th a Saturday, 9th a Sunday. */
function block(date: string, time: string): GridBlock {
  return { blockId: `${date}T${time}`, utcInstant: `${date}T${time}:00Z` };
}

const BLOCKS: GridBlock[] = [
  block('2026-08-03', '10:00'), // Mon morning
  block('2026-08-03', '18:00'), // Mon evening
  block('2026-08-03', '20:00'), // Mon later
  block('2026-08-08', '10:00'), // Sat morning
  block('2026-08-08', '18:00'), // Sat evening
];

describe('AvailabilityGridComponent — quick filters', () => {
  let fixture: ComponentFixture<AvailabilityGridComponent>;
  let component: AvailabilityGridComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AvailabilityGridComponent],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    fixture = TestBed.createComponent(AvailabilityGridComponent);
    component = fixture.componentInstance;
    component.blocks = BLOCKS;
    fixture.detectChanges();
  });

  const selected = () => Array.from(component.selected).sort();

  it('a day filter selects only that kind of day', () => {
    component.toggleDayFilter('weekdays');
    expect(selected()).toEqual([
      '2026-08-03T10:00',
      '2026-08-03T18:00',
      '2026-08-03T20:00',
    ]);
  });

  it('combines a day filter with a time filter as an intersection', () => {
    // The whole point: "Weekdays" + "After 5 PM" is weekday EVENINGS, not
    // every weekday plus every evening.
    component.toggleDayFilter('weekdays');
    component.clear();
    component.toggleDayFilter('weekdays');
    component.toggleTimeFilter('after5');

    expect(selected()).toEqual(['2026-08-03T18:00', '2026-08-03T20:00']);
  });

  it('unions the two day filters with each other', () => {
    component.toggleDayFilter('weekdays');
    component.toggleDayFilter('weekends');
    component.toggleTimeFilter('after5');
    expect(selected()).toEqual(['2026-08-03T18:00', '2026-08-03T20:00', '2026-08-08T18:00']);
  });

  it('toggles a filter back off', () => {
    component.toggleDayFilter('weekdays');
    expect(component.isDayFilterActive('weekdays')).toBeTrue();
    component.toggleDayFilter('weekdays');
    expect(component.isDayFilterActive('weekdays')).toBeFalse();
    expect(component.hasActiveFilters).toBeFalse();
  });

  it('keeps time filters mutually exclusive', () => {
    // "after 5" AND "after 7" would just mean "after 5" -- offering them as
    // independent toggles would be a control that silently does nothing.
    component.toggleTimeFilter('after5');
    component.toggleTimeFilter('after7');
    expect(component.isTimeFilterActive('after5')).toBeFalse();
    expect(component.isTimeFilterActive('after7')).toBeTrue();
  });

  it('a later threshold selects strictly less', () => {
    component.toggleTimeFilter('after7');
    expect(selected()).toEqual(['2026-08-03T20:00']);
  });

  it('the morning filter respects its upper bound', () => {
    component.toggleTimeFilter('morning');
    expect(selected()).toEqual(['2026-08-03T10:00', '2026-08-08T10:00']);
  });

  it('never wipes out hand-painted cells', () => {
    component.onCellClick('2026-08-08T10:00');
    component.toggleDayFilter('weekdays');
    expect(component.selected.has('2026-08-08T10:00')).toBeTrue();
  });

  it('toggling a filter off removes its cells but keeps painted ones', () => {
    component.onCellClick('2026-08-08T10:00');
    component.toggleDayFilter('weekdays');
    expect(component.selected.has('2026-08-03T18:00')).toBeTrue();

    component.toggleDayFilter('weekdays');

    // The filter's cells go; the hand-painted one stays. Filters that only
    // ever added would make an "off" toggle do nothing at all.
    expect(component.selected.has('2026-08-03T18:00')).toBeFalse();
    expect(component.selected.has('2026-08-08T10:00')).toBeTrue();
  });

  it('offers a sensible default set when the creator picked none', () => {
    expect(component.timeFilters.map((f) => f.id)).toEqual(['after5', 'after7']);
  });

  it('honours a creator-chosen filter set', () => {
    component.timeFilterIds = ['morning', 'after8'];
    expect(component.timeFilters.map((f) => f.id)).toEqual(['morning', 'after8']);
  });

  it('falls back to the default when given an empty set', () => {
    component.timeFilterIds = [];
    expect(component.timeFilters.length).toBeGreaterThan(0);
  });

  it('clearing resets both the selection and the filters', () => {
    component.toggleDayFilter('weekdays');
    component.toggleTimeFilter('after5');
    component.clear();
    expect(component.selected.size).toBe(0);
    expect(component.hasActiveFilters).toBeFalse();
  });
});

describe('AvailabilityGridComponent — quick answers', () => {
  let fixture: ComponentFixture<AvailabilityGridComponent>;
  let component: AvailabilityGridComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AvailabilityGridComponent],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    fixture = TestBed.createComponent(AvailabilityGridComponent);
    component = fixture.componentInstance;
    component.blocks = BLOCKS;
    fixture.detectChanges();
  });

  it('answers "weekday evenings" in one tap', () => {
    component.applyQuickAnswer('weekday-evenings');
    expect(Array.from(component.selected).sort()).toEqual([
      '2026-08-03T18:00',
      '2026-08-03T20:00',
    ]);
    expect(component.isQuickAnswerActive('weekday-evenings')).toBeTrue();
  });

  it('answers "weekends" in one tap', () => {
    component.applyQuickAnswer('weekends');
    expect(Array.from(component.selected).sort()).toEqual([
      '2026-08-08T10:00',
      '2026-08-08T18:00',
    ]);
  });

  it('replaces rather than accumulates, so two answers are never both on', () => {
    component.applyQuickAnswer('weekday-evenings');
    component.applyQuickAnswer('weekends');
    expect(component.isQuickAnswerActive('weekday-evenings')).toBeFalse();
    expect(component.isQuickAnswerActive('weekends')).toBeTrue();
  });

  it('narrows correctly when going from "anytime" to a specific answer', () => {
    // Regression: "anytime" via selectAll() wrote into the hand-painted set,
    // which filters never take back — so this left everything selected and
    // "Weekends" looked like a dead control.
    component.applyQuickAnswer('anytime');
    expect(component.selected.size).toBe(BLOCKS.length);

    component.applyQuickAnswer('weekends');
    expect(Array.from(component.selected).sort()).toEqual([
      '2026-08-08T10:00',
      '2026-08-08T18:00',
    ]);
  });

  it('tapping the active answer again undoes it', () => {
    component.applyQuickAnswer('weekends');
    component.applyQuickAnswer('weekends');
    expect(component.selected.size).toBe(0);
    expect(component.isQuickAnswerActive('weekends')).toBeFalse();
  });

  it('"anytime" selects everything, and toggles back off', () => {
    component.applyQuickAnswer('anytime');
    expect(component.selected.size).toBe(BLOCKS.length);
    expect(component.isQuickAnswerActive('anytime')).toBeTrue();

    component.applyQuickAnswer('anytime');
    expect(component.selected.size).toBe(0);
  });

  it('hides the evenings answer when the creator offers no evening filter', () => {
    // A button labelled "Weekday evenings" on a mornings-only poll would be a
    // control that can't do what it says.
    component.timeFilterIds = ['morning'];
    expect(component.quickAnswers.map((q) => q.id)).toEqual(['weekends', 'anytime']);
  });

  it('keeps hand-painted cells when a quick answer is applied', () => {
    component.onCellClick('2026-08-08T10:00');
    component.applyQuickAnswer('weekday-evenings');
    expect(component.selected.has('2026-08-08T10:00')).toBeTrue();
  });
});

/**
 * The phone layout replaced a grid that was unusable on touch: it set
 * `touch-action: none`, so a sideways swipe painted a streak of cells rather
 * than panning to more days, and a vertical swipe painted rather than
 * scrolling the page. These cover the day-at-a-time model that replaced it.
 */
describe('AvailabilityGridComponent — phone layout', () => {
  let fixture: ComponentFixture<AvailabilityGridComponent>;
  let component: AvailabilityGridComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AvailabilityGridComponent],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    fixture = TestBed.createComponent(AvailabilityGridComponent);
    component = fixture.componentInstance;
    component.blocks = BLOCKS;
    component.ngOnChanges({ blocks: { currentValue: BLOCKS } as never });
    fixture.detectChanges();
  });

  /** The handlers read only these three fields. */
  const pointer = (x: number, y: number) =>
    ({ isPrimary: true, clientX: x, clientY: y }) as PointerEvent;

  const swipe = (fromX: number, toX: number, fromY = 0, toY = 0) => {
    component.onListPointerDown(pointer(fromX, fromY));
    component.onListPointerUp(pointer(toX, toY));
  };

  it('shows one day at a time', () => {
    expect(component.colDates).toEqual(['2026-08-03', '2026-08-08']);
    expect(component.activeDayBlocks.map((b) => b.blockId)).toEqual([
      '2026-08-03T10:00',
      '2026-08-03T18:00',
      '2026-08-03T20:00',
    ]);
  });

  it('moves between days and stops at both ends', () => {
    component.nextDay();
    expect(component.activeDayIndex).toBe(1);
    component.nextDay();
    expect(component.activeDayIndex).toBe(1);
    component.prevDay();
    component.prevDay();
    expect(component.activeDayIndex).toBe(0);
  });

  it('counts selections per day, which is what the chip dots read', () => {
    component.onCellClick('2026-08-03T10:00');
    component.onCellClick('2026-08-08T18:00');
    expect(component.selectedCountForDay('2026-08-03')).toBe(1);
    expect(component.selectedCountForDay('2026-08-08')).toBe(1);
  });

  it('selects and clears just the day on screen', () => {
    component.selectActiveDay();
    expect(component.selectedCountForDay('2026-08-03')).toBe(3);
    expect(component.selectedCountForDay('2026-08-08')).toBe(0);
    expect(component.activeDayFullySelected).toBeTrue();

    component.clearActiveDay();
    expect(component.selectedCountForDay('2026-08-03')).toBe(0);
  });

  it('a decisive horizontal swipe changes the day', () => {
    swipe(300, 200); // leftward -> next
    expect(component.activeDayIndex).toBe(1);
    swipe(200, 300); // rightward -> prev
    expect(component.activeDayIndex).toBe(0);
  });

  it('ignores a short drag, so a tap is never read as a swipe', () => {
    swipe(300, 280);
    expect(component.activeDayIndex).toBe(0);
  });

  it('ignores a mostly-vertical drag, so scrolling never changes the day', () => {
    // The failure this prevents: a diagonal scroll-flick flipping the day out
    // from under the user mid-scroll.
    swipe(300, 220, 0, 200);
    expect(component.activeDayIndex).toBe(0);
  });

  it('a swipe that starts on a time row does not also toggle it', () => {
    // pointerup precedes click, so the guard is already set by then.
    swipe(300, 200);
    component.onCellClick('2026-08-03T10:00');
    expect(component.selected.has('2026-08-03T10:00')).toBeFalse();

    // ...and only the one click is swallowed.
    component.onCellClick('2026-08-03T10:00');
    expect(component.selected.has('2026-08-03T10:00')).toBeTrue();
  });

  it('clamps the active day when the poll range shrinks under it', () => {
    component.nextDay();
    expect(component.activeDayIndex).toBe(1);

    const shorter = BLOCKS.filter((b) => b.blockId.startsWith('2026-08-03'));
    component.blocks = shorter;
    component.ngOnChanges({ blocks: { currentValue: shorter } as never });

    expect(component.activeDayIndex).toBe(0);
    expect(component.activeDayBlocks.length).toBe(3);
  });

  it('renders the day list instead of the grid, and never both', () => {
    // The two layouts are swapped by *ngIf, so this also guards the thing AOT
    // can't: that the phone branch is reachable and the grid is really gone
    // (its pointer listeners are what made touch unusable).
    component.isPhone = true;
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelectorAll('.time-row').length).toBe(3);
    expect(el.querySelector('.grid')).toBeNull();
    expect(el.querySelectorAll('.day-chip').length).toBe(2);

    component.isPhone = false;
    fixture.detectChanges();
    expect(el.querySelector('.grid')).not.toBeNull();
    expect(el.querySelector('.time-row')).toBeNull();
  });

  it('marks the row for a selected block', () => {
    component.isPhone = true;
    component.onCellClick('2026-08-03T18:00');
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.time-row');
    expect(rows[1].classList).toContain('time-row--selected');
    expect(rows[1].getAttribute('aria-pressed')).toBe('true');
    expect(rows[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('fills the range between two taps', () => {
    // The whole point: a 4-hour window used to be one tap per 30-minute slot.
    component.onTimeRowClick('2026-08-03T10:00');
    expect(component.rangeAnchorId).toBe('2026-08-03T10:00');

    component.onTimeRowClick('2026-08-03T20:00');
    expect(Array.from(component.selected).sort()).toEqual([
      '2026-08-03T10:00',
      '2026-08-03T18:00',
      '2026-08-03T20:00',
    ]);
    expect(component.rangeAnchorId).toBeNull();
  });

  it('closes a range regardless of which end is tapped first', () => {
    component.onTimeRowClick('2026-08-03T20:00');
    component.onTimeRowClick('2026-08-03T10:00');
    expect(component.selected.size).toBe(3);
  });

  it('tapping a picked time un-picks it and cancels a pending range', () => {
    component.onTimeRowClick('2026-08-03T10:00');
    expect(component.rangeAnchorId).toBe('2026-08-03T10:00');

    component.onTimeRowClick('2026-08-03T10:00');
    expect(component.selected.has('2026-08-03T10:00')).toBeFalse();
    expect(component.rangeAnchorId).toBeNull();
  });

  it('drops a pending range when the day changes', () => {
    // Otherwise the next tap fills a range the user never started, on a day
    // they were only passing through.
    component.onTimeRowClick('2026-08-03T10:00');
    component.nextDay();
    expect(component.rangeAnchorId).toBeNull();

    component.onTimeRowClick('2026-08-08T18:00');
    expect(component.selected.has('2026-08-08T10:00')).toBeFalse();
  });

  it('copies the day on screen to every other day by time-of-day', () => {
    component.onTimeRowClick('2026-08-03T18:00');
    component.copyActiveDayToAllDays();
    expect(component.selected.has('2026-08-08T18:00')).toBeTrue();
    expect(component.selected.has('2026-08-08T10:00')).toBeFalse();
  });

  it('copying a day with nothing picked does nothing', () => {
    component.copyActiveDayToAllDays();
    expect(component.selected.size).toBe(0);
  });

  it('builds the day index from blocks, not from grid rows', () => {
    // A sparse grid (a day missing a time the others have) would shift every
    // later day by one if the day index were sliced out of `rows`.
    const sparse: GridBlock[] = [
      block('2026-08-03', '10:00'),
      block('2026-08-03', '18:00'),
      block('2026-08-08', '18:00'), // no 10:00 on this day
    ];
    component.blocks = sparse;
    component.ngOnChanges({ blocks: { currentValue: sparse } as never });

    component.goToDay(1);
    expect(component.activeDayBlocks.map((b) => b.blockId)).toEqual(['2026-08-08T18:00']);
  });
});
