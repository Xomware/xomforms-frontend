import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  forwardRef,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/** One rendered cell in the month grid. `null` date = leading/trailing padding. */
export interface DayCell {
  date: string | null; // YYYY-MM-DD
  day: number | null;
  disabled: boolean;
  today: boolean;
  selected: boolean;
}

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Local-time "YYYY-MM-DD". Deliberately NOT toISOString(), which is UTC and
 *  can roll the date backwards for anyone west of Greenwich. */
function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parse "YYYY-MM-DD" as a LOCAL calendar date (new Date(str) parses as UTC). */
function parseDateString(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A styled date picker matching `xf-select`'s chrome and popover behavior.
 *
 * The native `<input type="date">` popup is OS chrome — not stylable by CSS at
 * all — so a date field could never be made to match the app's `--xf-*` input
 * system the way the dropdowns do. This renders its own month grid instead.
 *
 * Value is the same "YYYY-MM-DD" string the native input used, so it drops into
 * the existing reactive forms and wire format unchanged.
 */
@Component({
  selector: 'xf-date',
  templateUrl: './styled-date.component.html',
  styleUrls: ['./styled-date.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => StyledDateComponent),
      multi: true,
    },
  ],
})
export class StyledDateComponent implements ControlValueAccessor {
  /** Earliest selectable date, "YYYY-MM-DD". Days before it render disabled. */
  @Input() min: string | null = null;
  /** Latest selectable date, "YYYY-MM-DD". */
  @Input() max: string | null = null;
  @Input() placeholder = 'Pick a date';
  @Input() ariaLabel = '';
  @Output() valueChange = new EventEmitter<string>();

  readonly weekdayLabels = WEEKDAY_LABELS;

  open = false;
  value: string | null = null;
  disabled = false;

  /** First of the month currently rendered in the grid. */
  private viewMonth: Date = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  constructor(private host: ElementRef<HTMLElement>) {}

  // ── ControlValueAccessor ───────────────────────────────────────────
  writeValue(v: string | null): void {
    this.value = v || null;
    // Opening on the month that holds the current value is the only sensible
    // starting view.
    const parsed = parseDateString(this.value);
    if (parsed) {
      this.viewMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
    }
  }
  registerOnChange(fn: (v: string) => void): void {
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
    return !!parseDateString(this.value);
  }

  /** e.g. "Mon, Aug 3, 2026" — long enough to be unambiguous. */
  get selectedLabel(): string {
    const parsed = parseDateString(this.value);
    if (!parsed) return this.placeholder;
    return parsed.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  get monthLabel(): string {
    return `${MONTH_LABELS[this.viewMonth.getMonth()]} ${this.viewMonth.getFullYear()}`;
  }

  /**
   * The visible month as 6 weeks of cells. Padding cells (before the 1st and
   * after the last) are rendered as empty placeholders so the weekday columns
   * stay aligned.
   */
  get weeks(): DayCell[][] {
    const year = this.viewMonth.getFullYear();
    const month = this.viewMonth.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = toDateString(new Date());

    const cells: DayCell[] = [];
    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ date: null, day: null, disabled: true, today: false, selected: false });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${pad2(month + 1)}-${pad2(day)}`;
      cells.push({
        date: dateStr,
        day,
        disabled: this.isOutOfRange(dateStr),
        today: dateStr === todayStr,
        selected: dateStr === this.value,
      });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ date: null, day: null, disabled: true, today: false, selected: false });
    }

    const weeks: DayCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }
    return weeks;
  }

  private isOutOfRange(dateStr: string): boolean {
    // String comparison is safe and exact for zero-padded ISO dates.
    if (this.min && dateStr < this.min) return true;
    if (this.max && dateStr > this.max) return true;
    return false;
  }

  // ── Interaction ────────────────────────────────────────────────────
  toggle(): void {
    if (this.disabled) return;
    this.open = !this.open;
    if (!this.open) this.onTouched();
  }

  prevMonth(): void {
    this.viewMonth = new Date(this.viewMonth.getFullYear(), this.viewMonth.getMonth() - 1, 1);
  }

  nextMonth(): void {
    this.viewMonth = new Date(this.viewMonth.getFullYear(), this.viewMonth.getMonth() + 1, 1);
  }

  selectDay(cell: DayCell): void {
    if (!cell.date || cell.disabled) return;
    this.value = cell.date;
    this.onChange(cell.date);
    this.valueChange.emit(cell.date);
    this.open = false;
    this.onTouched();
  }

  selectToday(): void {
    const today = toDateString(new Date());
    if (this.isOutOfRange(today)) return;
    this.selectDay({ date: today, day: null, disabled: false, today: true, selected: false });
  }

  get todayDisabled(): boolean {
    return this.isOutOfRange(toDateString(new Date()));
  }

  trackByDate(index: number, cell: DayCell): string {
    return cell.date ?? `pad-${index}`;
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
