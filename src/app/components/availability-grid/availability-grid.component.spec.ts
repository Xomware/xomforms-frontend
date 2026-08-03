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
