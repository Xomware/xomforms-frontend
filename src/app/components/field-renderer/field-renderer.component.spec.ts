import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FieldRendererComponent } from './field-renderer.component';
import { ChoiceFormField, ScaleFormField } from '../../models/poll.model';
import { AnswerValue } from '../../models/response.model';

describe('FieldRendererComponent', () => {
  let fixture: ComponentFixture<FieldRendererComponent>;
  let component: FieldRendererComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [FieldRendererComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(FieldRendererComponent);
    component = fixture.componentInstance;
  });

  it('single_choice emits a one-element optionId list', () => {
    component.field = {
      fieldId: 'f1',
      type: 'single_choice',
      label: 'Pick',
      options: [
        { optionId: 'o1', label: 'A' },
        { optionId: 'o2', label: 'B' },
      ],
    } as ChoiceFormField;

    let value: AnswerValue | undefined;
    component.valueChange.subscribe((v) => (value = v));
    component.selectSingle('o2');
    expect(value).toEqual(['o2']);
  });

  it('multi_choice toggles options in and out of the list', () => {
    component.field = {
      fieldId: 'f2',
      type: 'multi_choice',
      label: 'Pick many',
      options: [
        { optionId: 'a', label: 'A' },
        { optionId: 'b', label: 'B' },
      ],
    } as ChoiceFormField;

    const seen: AnswerValue[] = [];
    component.valueChange.subscribe((v) => seen.push(v));

    component.toggleMulti('a', true);
    expect(seen[seen.length - 1]).toEqual(['a']);

    component.value = ['a'];
    component.toggleMulti('b', true);
    expect(seen[seen.length - 1]).toEqual(['a', 'b']);

    component.value = ['a', 'b'];
    component.toggleMulti('a', false);
    expect(seen[seen.length - 1]).toEqual(['b']);
  });

  it('scale emits a single integer', () => {
    component.field = {
      fieldId: 's',
      type: 'scale',
      label: 'Rate',
      min: 1,
      max: 5,
    } as ScaleFormField;

    let value: AnswerValue | undefined;
    component.valueChange.subscribe((v) => (value = v));
    component.selectScale(4);
    expect(value).toBe(4);
  });

  it('scaleValues enumerates the inclusive range', () => {
    component.field = {
      fieldId: 's',
      type: 'scale',
      label: 'Rate',
      min: 1,
      max: 5,
    } as ScaleFormField;
    expect(component.scaleValues).toEqual([1, 2, 3, 4, 5]);
  });
});
