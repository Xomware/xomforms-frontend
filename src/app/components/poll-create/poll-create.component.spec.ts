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

  it('choosing Scheduler drops into the existing scheduler form', () => {
    component.chooseScheduler();
    expect(component.mode).toBe('scheduler');
    // The original scheduler controls are intact and untouched.
    expect(component.form.get('startDate')).toBeTruthy();
    expect(component.form.get('granularityMinutes')?.value).toBe(30);
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
