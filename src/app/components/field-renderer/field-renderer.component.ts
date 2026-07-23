import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AnswerValue } from '../../models/response.model';
import { FormField, isChoiceField, isScaleField } from '../../models/poll.model';

/**
 * Renders one Q&A field as an accessible respondent input and emits the typed
 * answer value: single_choice -> [optionId], multi_choice -> optionId[],
 * dropdown -> [optionId], scale -> int. Answer shapes mirror the backend
 * contract (choice answers are always optionId lists, like the scheduler's
 * blocks). All choice groups are wrapped in a fieldset/legend for screen
 * readers; the scale is a radiogroup of labelled buttons (keyboard-navigable).
 */
@Component({
  selector: 'app-field-renderer',
  templateUrl: './field-renderer.component.html',
  styleUrls: ['./field-renderer.component.scss'],
})
export class FieldRendererComponent {
  @Input() field!: FormField;
  /** The current answer, so the control reflects prior state on re-render. */
  @Input() value: AnswerValue | null = null;
  @Output() valueChange = new EventEmitter<AnswerValue>();

  get isChoice(): boolean {
    return isChoiceField(this.field);
  }

  get isScale(): boolean {
    return isScaleField(this.field);
  }

  get isDropdown(): boolean {
    return this.field.type === 'dropdown';
  }

  get isSingle(): boolean {
    return this.field.type === 'single_choice';
  }

  get isMulti(): boolean {
    return this.field.type === 'multi_choice';
  }

  get options() {
    return isChoiceField(this.field) ? this.field.options : [];
  }

  /** Inclusive integer range [min..max] for a scale field. */
  get scaleValues(): number[] {
    if (!isScaleField(this.field)) return [];
    const out: number[] = [];
    for (let v = this.field.min; v <= this.field.max; v += 1) out.push(v);
    return out;
  }

  get scaleMinLabel(): string {
    return isScaleField(this.field) ? this.field.minLabel ?? '' : '';
  }

  get scaleMaxLabel(): string {
    return isScaleField(this.field) ? this.field.maxLabel ?? '' : '';
  }

  private get selected(): string[] {
    return Array.isArray(this.value) ? this.value : [];
  }

  isSelected(optionId: string): boolean {
    return this.selected.includes(optionId);
  }

  isScaleSelected(v: number): boolean {
    return this.value === v;
  }

  /** Radio / dropdown (single selection) -> emit a one-element list. */
  selectSingle(optionId: string): void {
    this.valueChange.emit([optionId]);
  }

  onDropdownChange(optionId: string): void {
    this.valueChange.emit(optionId ? [optionId] : []);
  }

  /** Checkbox (multi) -> toggle the option in/out of the list. */
  toggleMulti(optionId: string, checked: boolean): void {
    const next = new Set(this.selected);
    if (checked) {
      next.add(optionId);
    } else {
      next.delete(optionId);
    }
    this.valueChange.emit(Array.from(next));
  }

  selectScale(v: number): void {
    this.valueChange.emit(v);
  }

  /** Stable id for label/for wiring. */
  controlId(suffix: string | number): string {
    return `field-${this.field.fieldId}-${suffix}`;
  }
}
