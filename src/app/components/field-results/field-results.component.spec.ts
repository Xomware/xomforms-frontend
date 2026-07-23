import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FieldResultsComponent } from './field-results.component';
import { FieldResult } from '../../models/response.model';

describe('FieldResultsComponent', () => {
  let fixture: ComponentFixture<FieldResultsComponent>;
  let component: FieldResultsComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [FieldResultsComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(FieldResultsComponent);
    component = fixture.componentInstance;
  });

  it('option bar widths track the ratio and flag the top option', () => {
    component.result = {
      fieldId: 'f1',
      type: 'single_choice',
      label: 'Attending?',
      totalResponses: 4,
      options: [
        { optionId: 'o1', label: 'Yes', count: 3, total: 4, ratio: 0.75 },
        { optionId: 'o2', label: 'No', count: 1, total: 4, ratio: 0.25 },
      ],
      buckets: [],
    } as FieldResult;

    const bars = component.optionBars;
    expect(bars[0].width).toBe('75%');
    expect(bars[0].pct).toBe('75%');
    expect(bars[0].isTop).toBeTrue();
    expect(bars[1].width).toBe('25%');
    expect(bars[1].isTop).toBeFalse();
  });

  it('a single vote still renders a visible (>=2%) sliver', () => {
    component.result = {
      fieldId: 'f1',
      type: 'single_choice',
      label: 'x',
      totalResponses: 100,
      options: [{ optionId: 'o1', label: 'A', count: 1, total: 100, ratio: 0.01 }],
      buckets: [],
    } as FieldResult;
    expect(component.optionBars[0].width).toBe('2%');
  });

  it('scale exposes the mean and per-value histogram', () => {
    component.result = {
      fieldId: 's',
      type: 'scale',
      label: 'Excitement',
      totalResponses: 3,
      options: [],
      buckets: [
        { value: 1, count: 0, total: 3, ratio: 0 },
        { value: 2, count: 1, total: 3, ratio: 1 / 3 },
        { value: 3, count: 2, total: 3, ratio: 2 / 3 },
      ],
      mean: 2.67,
      min: 2,
      max: 3,
    } as FieldResult;

    expect(component.isScale).toBeTrue();
    expect(component.meanLabel).toBe('2.67');
    const bars = component.scaleBars;
    expect(bars.length).toBe(3);
    expect(bars[2].isTop).toBeTrue();
    expect(bars[0].width).toBe('0%');
  });
});
