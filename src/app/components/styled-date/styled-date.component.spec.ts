import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StyledDateComponent } from './styled-date.component';

describe('StyledDateComponent', () => {
  let fixture: ComponentFixture<StyledDateComponent>;
  let component: StyledDateComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [StyledDateComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(StyledDateComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  /** Flatten the month grid to just the real (non-padding) day cells. */
  const realDays = () => component.weeks.flat().filter((c) => c.date !== null);

  it('opens on the month holding the current value', () => {
    component.writeValue('2026-03-14');
    expect(component.monthLabel).toBe('March 2026');
    expect(realDays().length).toBe(31);
  });

  it('parses the value as a LOCAL date, not UTC', () => {
    // new Date('2026-03-14') is UTC midnight, which is the 13th for anyone
    // west of Greenwich -- the label must still read the 14th.
    component.writeValue('2026-03-14');
    expect(component.selectedLabel).toContain('14');
    expect(component.selectedLabel).toContain('Mar');
  });

  it('pads each week to 7 cells so weekday columns stay aligned', () => {
    component.writeValue('2026-03-14');
    for (const week of component.weeks) {
      expect(week.length).toBe(7);
    }
  });

  it('handles month rollover in both directions across a year boundary', () => {
    component.writeValue('2026-01-15');
    component.prevMonth();
    expect(component.monthLabel).toBe('December 2025');
    component.nextMonth();
    component.nextMonth();
    expect(component.monthLabel).toBe('February 2026');
    // 2026 is not a leap year.
    expect(realDays().length).toBe(28);
  });

  it('disables days before min and after max', () => {
    component.min = '2026-03-10';
    component.max = '2026-03-20';
    component.writeValue('2026-03-14');

    const byDate = (d: string) => realDays().find((c) => c.date === d);
    expect(byDate('2026-03-09')?.disabled).toBeTrue();
    expect(byDate('2026-03-10')?.disabled).toBeFalse();
    expect(byDate('2026-03-20')?.disabled).toBeFalse();
    expect(byDate('2026-03-21')?.disabled).toBeTrue();
  });

  it('refuses to select a disabled day', () => {
    component.min = '2026-03-10';
    component.writeValue('2026-03-14');
    const emitted: string[] = [];
    component.registerOnChange((v) => emitted.push(v));

    const blocked = realDays().find((c) => c.date === '2026-03-05')!;
    component.selectDay(blocked);

    expect(emitted).toEqual([]);
    expect(component.value).toBe('2026-03-14');
  });

  it('emits the picked date and closes on select', () => {
    component.writeValue('2026-03-14');
    component.open = true;
    const emitted: string[] = [];
    component.registerOnChange((v) => emitted.push(v));

    const target = realDays().find((c) => c.date === '2026-03-18')!;
    component.selectDay(target);

    expect(emitted).toEqual(['2026-03-18']);
    expect(component.value).toBe('2026-03-18');
    expect(component.open).toBeFalse();
  });

  it('shows the placeholder until a value is set', () => {
    component.placeholder = 'Pick a date';
    component.writeValue(null);
    expect(component.hasValue).toBeFalse();
    expect(component.selectedLabel).toBe('Pick a date');
  });

  it('closes on Escape', () => {
    component.open = true;
    component.onEscape();
    expect(component.open).toBeFalse();
  });

  it('does not open when disabled', () => {
    component.setDisabledState(true);
    component.toggle();
    expect(component.open).toBeFalse();
  });
});
