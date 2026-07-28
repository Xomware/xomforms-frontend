import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  forwardRef,
  HostListener,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/** One selectable option. `group` optionally buckets options under a heading. */
export interface SelectOption {
  value: string | number;
  label: string;
  group?: string;
}

interface OptionGroup {
  name: string | null;
  options: SelectOption[];
}

/**
 * A small, reusable styled dropdown that matches the app's `--xf-*` input
 * chrome (the native `<select>`, especially the ~400-entry timezone one,
 * rendered unstyled and inconsistent). Implements ControlValueAccessor so it
 * drops straight into a reactive form via `formControlName`.
 *
 * Optional `searchable` adds a filter box (for the long timezone list), and
 * options may declare a `group` to render pinned headings (detected zone /
 * common zones / all zones), preserving the given order.
 */
@Component({
  selector: 'xf-select',
  templateUrl: './styled-select.component.html',
  styleUrls: ['./styled-select.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => StyledSelectComponent),
      multi: true,
    },
  ],
})
export class StyledSelectComponent implements ControlValueAccessor {
  @Input() options: SelectOption[] = [];
  @Input() searchable = false;
  @Input() placeholder = 'Select…';
  @Input() ariaLabel = '';
  @Output() valueChange = new EventEmitter<string | number>();

  open = false;
  search = '';
  value: string | number | null = null;
  disabled = false;

  private onChange: (v: string | number) => void = () => {};
  private onTouched: () => void = () => {};

  constructor(private host: ElementRef<HTMLElement>) {}

  // ── ControlValueAccessor ───────────────────────────────────────────
  writeValue(v: string | number | null): void {
    this.value = v;
  }
  registerOnChange(fn: (v: string | number) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  // ── Derived view state ─────────────────────────────────────────────
  get hasValue(): boolean {
    return this.options.some((o) => o.value === this.value);
  }

  get selectedLabel(): string {
    const found = this.options.find((o) => o.value === this.value);
    return found ? found.label : this.placeholder;
  }

  get filteredGroups(): OptionGroup[] {
    const q = this.search.trim().toLowerCase();
    const groups: OptionGroup[] = [];
    const index = new Map<string | null, OptionGroup>();
    for (const opt of this.options) {
      if (q && !opt.label.toLowerCase().includes(q)) continue;
      const key = opt.group ?? null;
      let g = index.get(key);
      if (!g) {
        g = { name: key, options: [] };
        index.set(key, g);
        groups.push(g);
      }
      g.options.push(opt);
    }
    return groups;
  }

  // ── Interaction ────────────────────────────────────────────────────
  toggle(): void {
    if (this.disabled) return;
    this.open = !this.open;
    if (this.open) {
      this.search = '';
    } else {
      this.onTouched();
    }
  }

  select(opt: SelectOption): void {
    this.value = opt.value;
    this.onChange(opt.value);
    this.valueChange.emit(opt.value);
    this.open = false;
    this.onTouched();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(ev.target as Node)) {
      this.open = false;
      this.onTouched();
    }
  }

  @HostListener('keydown.escape')
  onEscape(): void {
    if (this.open) {
      this.open = false;
      this.onTouched();
    }
  }
}
