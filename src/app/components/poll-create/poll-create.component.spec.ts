import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { PollCreateComponent } from './poll-create.component';

describe('PollCreateComponent — starter picker + builder', () => {
  let fixture: ComponentFixture<PollCreateComponent>;
  let component: PollCreateComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [PollCreateComponent],
      imports: [ReactiveFormsModule, FormsModule, HttpClientTestingModule, RouterTestingModule],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    fixture = TestBed.createComponent(PollCreateComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('starts on the picker', () => {
    expect(component.mode).toBe('picker');
  });

  it('choosing Scheduler drops into the duration + start-range form', () => {
    component.chooseScheduler();
    expect(component.mode).toBe('scheduler');
    // Start times are minutes since midnight, not "HH:MM" strings.
    expect(component.form.get('startDate')).toBeTruthy();
    expect(component.form.get('eventDurationMinutes')?.value).toBe(120);
    expect(component.form.get('earliestStartMinute')?.value).toBe(18 * 60);
    expect(component.form.get('latestStartMinute')?.value).toBe(21 * 60);
    // 30-minute starts by default -- 15 is more granularity than most groups need.
    expect(component.form.get('granularityMinutes')?.value).toBe(30);
  });

  it('warns that the latest start crosses midnight when the event runs overnight', () => {
    component.chooseScheduler();
    component.form.get('latestStartMinute')?.setValue(22 * 60);
    component.form.get('eventDurationMinutes')?.setValue(180); // 3h -> ends 1:00 AM next day
    const summary = component.latestEndSummary;
    expect(summary?.label).toBe('1:00 AM');
    expect(summary?.nextDay).toBeTrue();
  });

  it('flags an out-of-order start range', () => {
    component.chooseScheduler();
    component.form.get('earliestStartMinute')?.setValue(21 * 60);
    component.form.get('latestStartMinute')?.setValue(18 * 60);
    expect(component.startRangeValid).toBeFalse();
  });

  it('builds a responder preview grid at the chosen start interval', () => {
    component.chooseScheduler();
    component.form.patchValue({
      startDate: '2026-08-03',
      endDate: '2026-08-03',
      earliestStartMinute: 18 * 60,
      latestStartMinute: 21 * 60,
      eventDurationMinutes: 120,
    });
    expect(component.hasPreview).toBeTrue();
    // The grid offers candidate START TIMES: 18:00 through 21:00 inclusive,
    // in 30-min steps. It must NOT run to latest + duration -- that used to
    // draw rows for starts well past the latest the creator allowed.
    expect(component.previewBlocks[0].blockId).toBe('2026-08-03T18:00');
    expect(component.previewBlocks.some((b) => b.blockId === '2026-08-03T21:00')).toBeTrue();
    expect(component.previewBlocks.some((b) => b.blockId === '2026-08-03T21:30')).toBeFalse();
    expect(component.previewBlocks.some((b) => b.blockId === '2026-08-03T22:30')).toBeFalse();
    // Nothing lands off the interval.
    expect(component.previewBlocks.some((b) => b.blockId.endsWith(':15'))).toBeFalse();
    expect(component.previewBlocks.some((b) => b.blockId.endsWith(':45'))).toBeFalse();
  });

  // ── Start interval (granularity) ──────────────────────────────────
  it('only offers start times that land on the chosen interval', () => {
    component.chooseScheduler();

    component.setGranularity(60);
    expect(component.timeOptions.length).toBe(24);
    expect(component.timeOptions.every((o) => Number(o.value) % 60 === 0)).toBeTrue();

    component.setGranularity(15);
    expect(component.timeOptions.length).toBe(96);
    // 12:07 is exactly the kind of value the old free-text time input allowed.
    expect(component.timeOptions.some((o) => Number(o.value) === 12 * 60 + 7)).toBeFalse();
  });

  it('re-snaps an off-grid start time when the interval widens', () => {
    component.chooseScheduler();
    component.setGranularity(15);
    component.form.get('earliestStartMinute')?.setValue(18 * 60 + 15); // 6:15 PM

    component.setGranularity(60);
    expect(component.form.get('earliestStartMinute')?.value).toBe(18 * 60);
  });

  it('rounds event length UP onto the interval rather than shrinking it', () => {
    component.chooseScheduler();
    component.form.get('eventDurationMinutes')?.setValue(90); // 1.5h

    component.setGranularity(60);
    // 90 -> 120, never down to 60: a shorter event than asked for is the
    // worse surprise.
    expect(component.form.get('eventDurationMinutes')?.value).toBe(120);
    expect(component.durationOptions.every((o) => Number(o.value) % 60 === 0)).toBeTrue();
  });

  it('keeps every duration option within the backend 6-hour cap', () => {
    component.chooseScheduler();
    for (const step of [15, 30, 60]) {
      component.setGranularity(step);
      expect(Math.max(...component.durationOptions.map((o) => Number(o.value)))).toBeLessThanOrEqual(
        360,
      );
    }
  });

  it('choosing Blank opens the Q&A builder and seeds one field', () => {
    component.chooseBlankForm();
    expect(component.mode).toBe('qa');
    expect(component.qaFields.length).toBe(1);
    expect(component.qaFields[0].type).toBe('single_choice');
  });

  it('adds, reorders, and removes fields', () => {
    component.chooseBlankForm();
    component.addField('scale');
    expect(component.qaFields.length).toBe(2);
    expect(component.qaFields[1].type).toBe('scale');

    const firstId = component.qaFields[0].fieldId;
    component.moveField(0, 1);
    expect(component.qaFields[1].fieldId).toBe(firstId);

    component.removeField(0);
    expect(component.qaFields.length).toBe(1);
  });

  it('a Q&A form is invalid until every field has a label and enough options', () => {
    component.chooseBlankForm();
    component.form.get('title')?.setValue('My form');
    // Seeded field has default option labels but a blank question label.
    expect(component.qaFormValid).toBeFalse();

    component.qaFields[0].label = 'Attending?';
    expect(component.qaFormValid).toBeTrue();

    // Fewer than two options is invalid.
    component.qaFields[0].options = component.qaFields[0].options.slice(0, 1);
    expect(component.qaFormValid).toBeFalse();
  });

  it('scale fields validate on min < max', () => {
    component.chooseBlankForm();
    component.form.get('title')?.setValue('Survey');
    component.qaFields = [];
    component.addField('scale');
    component.qaFields[0].label = 'Rate it';
    expect(component.fieldValid(component.qaFields[0])).toBeTrue();

    component.qaFields[0].max = component.qaFields[0].min;
    expect(component.fieldValid(component.qaFields[0])).toBeFalse();
  });
});
