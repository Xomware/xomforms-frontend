import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { GridBlock } from '../../models/poll.model';
import { formatDayLong, formatLocal, formatTime, timezoneLabel, viewerTimeZone } from '../../models/grid.util';

/**
 * MUST stay in lockstep with the `phone` mixin in src/styles/_responsive.scss
 * ($breakpoint-sm - $bp-step = 576px - 0.02px). The two layouts are swapped by
 * *ngIf rather than by CSS `display`, so if this value and the mixin disagree
 * the app renders a layout its own stylesheet isn't styling.
 *
 * Why *ngIf and not CSS: rendering both layouts would double the DOM for what
 * is often 200+ cells, and would attach the desktop drag-paint pointer
 * listeners on phones — which is the exact behaviour this rebuild exists to
 * remove.
 */
export const PHONE_MEDIA_QUERY = '(max-width: 575.98px)';

/** Horizontal travel (px) that separates a day-swipe from a tap. */
const SWIPE_THRESHOLD_PX = 50;

/**
 * Drag-to-paint availability grid. Promoted from the Phase 0 throwaway
 * prototype (docs/features/xomforms/prototype/availability-grid.component.ts)
 * -- the interaction mechanics (pointer+touch drag-select/deselect,
 * touch-action: none, mode locked at drag start) are carried over
 * unchanged, since Phase 0's go/no-go verified them directly. What
 * changed for the real component:
 *   - Operates on real GridBlock[] (blockId/utcInstant) data instead of
 *     r/c indices -- selection is keyed by canonical blockId throughout.
 *   - Row labels render in the VIEWER's local timezone (not the poll's),
 *     per the plan's DST-safety design -- each row's label is taken from
 *     its first column's block for a stable, readable label; exact
 *     per-cell local time is available via the `title` tooltip.
 *   - Mobile touch targets grown toward the ~44px recommendation flagged
 *     in the Phase 0 findings (was ~28px at 390px/7-col).
 */

type PaintMode = 'select' | 'deselect' | null;

interface GridRow {
  label: string;
  cells: GridBlock[];
}

export type DayFilterId = 'weekdays' | 'weekends';
export type TimeFilterId = 'after4' | 'after5' | 'after6' | 'after7' | 'after8' | 'morning';

export interface TimeFilterOption {
  id: TimeFilterId;
  label: string;
  /** Inclusive lower bound as a zero-padded "HH:MM". */
  fromTime: string;
  /** Blocks at or after this are excluded (used by the morning filter). */
  untilTime?: string;
}

/**
 * The full menu a creator can choose from. Offering several thresholds rather
 * than a single "After 5 PM" matters because the useful cutoff depends
 * entirely on the group -- a work team and a 8pm league are not the same.
 */
export const TIME_FILTERS: TimeFilterOption[] = [
  { id: 'morning', label: 'Mornings', fromTime: '00:00', untilTime: '12:00' },
  { id: 'after4', label: 'After 4 PM', fromTime: '16:00' },
  { id: 'after5', label: 'After 5 PM', fromTime: '17:00' },
  { id: 'after6', label: 'After 6 PM', fromTime: '18:00' },
  { id: 'after7', label: 'After 7 PM', fromTime: '19:00' },
  { id: 'after8', label: 'After 8 PM', fromTime: '20:00' },
];

/** Shown when a creator hasn't picked a set -- the broadly useful ones. */
export const DEFAULT_TIME_FILTER_IDS: TimeFilterId[] = ['after5', 'after7'];

export type QuickAnswerId = 'weekday-evenings' | 'weekends' | 'anytime';

export interface QuickAnswer {
  id: QuickAnswerId;
  label: string;
}

@Component({
  selector: 'app-availability-grid',
  templateUrl: './availability-grid.component.html',
  styleUrls: ['./availability-grid.component.scss'],
})
export class AvailabilityGridComponent implements OnChanges, OnDestroy {
  /** The poll's full candidate grid, chronologically ordered (see grid.util.ts::generateGrid). */
  @Input() blocks: GridBlock[] = [];
  /** Pre-selected blockIds, e.g. when a respondent is editing a prior submission. */
  @Input() initialSelected: string[] = [];
  /**
   * Read-only sample mode: no painting, no toolbar/presets. Used by the
   * creator's pre-publish preview to show the derived grid layout + times.
   */
  @Input() readOnly = false;
  @Output() selectionChange = new EventEmitter<string[]>();

  /**
   * Setter rather than a plain @ViewChild: the desktop grid is behind an
   * *ngIf, so it appears and disappears as the viewport crosses the phone
   * breakpoint. ngAfterViewInit fires once and would leave the listeners
   * bound to a detached node (or never bound at all, if the app opened on a
   * phone-width viewport and was then widened).
   */
  @ViewChild('gridEl')
  set gridEl(ref: ElementRef<HTMLDivElement> | undefined) {
    const next = ref?.nativeElement;
    if (next === this.gridElement) return;
    this.detachListeners();
    this.gridElement = next;
    this.attachListeners();
  }
  private gridElement?: HTMLDivElement;

  rows: GridRow[] = [];
  colDates: string[] = [];
  selected = new Set<string>();

  /** True while the viewport is phone-width; drives the layout swap. */
  isPhone = false;
  /** Index into colDates — the single day the phone layout is showing. */
  activeDayIndex = 0;
  private blocksByDate = new Map<string, GridBlock[]>();
  private readonly phoneQuery = window.matchMedia(PHONE_MEDIA_QUERY);
  readonly viewerTz = viewerTimeZone();
  /** Readable form for the footnote; the raw id still drives formatting. */
  readonly viewerTzLabel = timezoneLabel(viewerTimeZone());

  private dragging = false;
  private paintMode: PaintMode = null;
  private lastPaintedKey: string | null = null;
  private listenersAttached = false;
  private pointerJustHandled = false;

  constructor(
    private readonly zone: NgZone,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.isPhone = this.phoneQuery.matches;
    this.phoneQuery.addEventListener('change', this.onPhoneQueryChange);
  }

  private onPhoneQueryChange = (ev: MediaQueryListEvent): void => {
    // matchMedia fires outside Angular's zone in some browsers, so the layout
    // swap would otherwise not repaint until the next unrelated event.
    this.zone.run(() => {
      this.isPhone = ev.matches;
      this.cdr.markForCheck();
    });
  };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['blocks']) {
      this.rebuildGrid();
    }
    if (changes['initialSelected']) {
      this.selected = new Set(this.initialSelected ?? []);
      // A prefilled answer counts as hand-picked: filters must not erase it.
      this.manualSelected = new Set(this.initialSelected ?? []);
    }
  }

  ngOnDestroy(): void {
    this.detachListeners();
    this.phoneQuery.removeEventListener('change', this.onPhoneQueryChange);
  }

  private attachListeners(): void {
    // Preview/read-only grids never paint -- skip all pointer wiring.
    if (this.readOnly) return;
    const el = this.gridElement;
    if (!el || this.listenersAttached) return;
    el.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    el.addEventListener('pointermove', this.onPointerMove, { passive: false });
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    this.listenersAttached = true;
  }

  private detachListeners(): void {
    const el = this.gridElement;
    if (!el || !this.listenersAttached) return;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    this.listenersAttached = false;
  }

  private rebuildGrid(): void {
    const dateSet = new Set<string>();
    const timeSet = new Set<string>();
    for (const block of this.blocks) {
      const [date, time] = block.blockId.split('T');
      dateSet.add(date);
      timeSet.add(time);
    }
    this.colDates = Array.from(dateSet).sort();
    const times = Array.from(timeSet).sort();

    const byBlockId = new Map(this.blocks.map((b) => [b.blockId, b] as const));

    // Day-major index for the phone layout. Built from `blocks` directly rather
    // than by slicing a column out of `rows`, because rows drop missing cells
    // and a sparse grid would silently shift every later day by one.
    this.blocksByDate = new Map();
    for (const block of this.blocks) {
      const date = block.blockId.split('T')[0];
      const bucket = this.blocksByDate.get(date);
      if (bucket) bucket.push(block);
      else this.blocksByDate.set(date, [block]);
    }
    // The poll's date range can change under us (creator preview re-renders on
    // every edit); an out-of-range index would render an empty day.
    this.activeDayIndex = Math.min(this.activeDayIndex, Math.max(this.colDates.length - 1, 0));

    this.rows = times.map((time) => {
      const cells = this.colDates.map((date) => byBlockId.get(`${date}T${time}`)).filter((b): b is GridBlock => !!b);
      const label = cells.length > 0 ? formatLocal(cells[0].utcInstant, this.viewerTz).split(', ').slice(-1)[0] : time;
      return { label, cells };
    });
  }

  isSelected(blockId: string): boolean {
    return this.selected.has(blockId);
  }

  /**
   * Keyboard-accessible toggle (Enter/Space on a focused cell). The native
   * `click` event ALSO fires after a plain pointer tap (mouse/touch), which
   * would double-toggle a cell the pointer handlers already painted --
   * `preventDefault()` on `pointerdown` suppresses that per the Pointer
   * Events spec, but `pointerJustHandled` is a defensive backstop in case
   * that spec behavior doesn't hold in some browser (this exact interaction
   * mechanism was Phase 0's top cross-browser risk area).
   */
  onCellClick(blockId: string): void {
    if (this.readOnly) return;
    if (this.pointerJustHandled) {
      this.pointerJustHandled = false;
      return;
    }
    // A day-swipe that started on a time row still ends with a click on it,
    // which would toggle a block the user only meant to swipe past. pointerup
    // (where swipeConsumed is set) always precedes click, so this is settled
    // by the time we get here. Angular templates can't bind capture-phase
    // listeners, so the guard lives at the handler rather than on the list.
    if (this.swipeConsumed) {
      this.swipeConsumed = false;
      return;
    }
    if (this.selected.has(blockId)) {
      this.selected.delete(blockId);
      this.manualSelected.delete(blockId);
    } else {
      this.selected.add(blockId);
      this.manualSelected.add(blockId);
    }
    this.emitSelection();
  }

  cellTitle(block: GridBlock): string {
    return formatLocal(block.utcInstant, this.viewerTz);
  }

  colHeaderLabel(date: string): string {
    // date is YYYY-MM-DD; show as e.g. "Mon Aug 3" using a fixed block for that date.
    const rep = this.blocks.find((b) => b.blockId.startsWith(date));
    return rep ? formatLocal(rep.utcInstant, this.viewerTz).split(',').slice(0, 2).join(',') : date;
  }

  clear(): void {
    this.selected.clear();
    this.manualSelected.clear();
    this.clearFilters();
    this.emitSelection();
  }

  // ── Quick answers ──────────────────────────────────────────────────
  // Most people's availability is a sentence, not a set of 40 cells: "weekday
  // evenings", "weekends", "whenever". The primitives to express that already
  // existed as day/time filters, but they were rendered as small pills in a
  // toolbar above the grid, so they read as a secondary utility and the grid
  // read as the way to answer. These are the same primitives promoted to the
  // top and phrased as an answer to a question.

  /**
   * The first non-morning filter the creator left enabled — what "evenings"
   * resolves to for this poll. A creator who offers only mornings gets no
   * evening quick answer rather than a button that lies.
   */
  private get eveningFilterId(): TimeFilterId | null {
    return this.enabledTimeFilters.find((f) => f.id !== 'morning')?.id ?? null;
  }

  get quickAnswers(): QuickAnswer[] {
    const out: QuickAnswer[] = [];
    if (this.eveningFilterId) out.push({ id: 'weekday-evenings', label: 'Weekday evenings' });
    out.push({ id: 'weekends', label: 'Weekends' });
    out.push({ id: 'anytime', label: "I'm free anytime" });
    return out;
  }

  isQuickAnswerActive(id: QuickAnswerId): boolean {
    if (id === 'anytime') {
      return (
        this.activeTimeFilterId === null &&
        this.activeDayFilters.has('weekdays') &&
        this.activeDayFilters.has('weekends')
      );
    }
    if (id === 'weekends') {
      return (
        this.activeTimeFilterId === null &&
        this.activeDayFilters.size === 1 &&
        this.activeDayFilters.has('weekends')
      );
    }
    return (
      this.activeTimeFilterId === this.eveningFilterId &&
      this.activeDayFilters.size === 1 &&
      this.activeDayFilters.has('weekdays')
    );
  }

  /**
   * Quick answers REPLACE the current filter combination rather than adding to
   * it — they're answers to one question, so two of them being on at once
   * would be incoherent. Hand-painted cells still survive, as with any filter.
   */
  applyQuickAnswer(id: QuickAnswerId): void {
    if (this.isQuickAnswerActive(id)) {
      // Tapping the active answer again undoes it, so the control is a toggle
      // in both directions rather than a one-way trap.
      this.clearFilters();
      this.applyFilters();
      return;
    }

    this.clearFilters();
    if (id === 'anytime') {
      // Expressed as "every day, no time restriction" rather than via
      // selectAll(). selectAll() writes into the hand-painted set, which
      // filters deliberately never take back — so a subsequent "Weekends"
      // would have left everything selected and looked like a dead control.
      this.activeDayFilters.add('weekdays');
      this.activeDayFilters.add('weekends');
    } else if (id === 'weekends') {
      this.activeDayFilters.add('weekends');
    } else {
      this.activeDayFilters.add('weekdays');
      this.activeTimeFilterId = this.eveningFilterId;
    }
    this.applyFilters();
  }

  // ── Phone layout ───────────────────────────────────────────────────
  // One day at a time as a full-width vertical list. This exists because the
  // desktop grid is unusable on a phone: it set `touch-action: none`, so a
  // sideways swipe painted a streak of cells instead of panning to more days,
  // and a vertical swipe painted instead of scrolling the page. With the grid
  // taller than the viewport there was nowhere left to start a scroll from.
  //
  // Here the browser owns vertical scrolling outright, each row is a
  // full-width tap target, and days are changed by an explicit control rather
  // than by a gesture that overlaps painting.

  /** Blocks for the day currently on screen, chronological. */
  get activeDayBlocks(): GridBlock[] {
    const date = this.colDates[this.activeDayIndex];
    return date ? (this.blocksByDate.get(date) ?? []) : [];
  }

  /** e.g. "Saturday, Aug 1" — full weekday, since there's room for it here. */
  get activeDayLabel(): string {
    const first = this.activeDayBlocks[0];
    return first ? formatDayLong(first.utcInstant, this.viewerTz) : '';
  }

  /** Short chip label, e.g. "Sat 1". */
  dayChipLabel(date: string): string {
    const first = this.blocksByDate.get(date)?.[0];
    if (!first) return date;
    // formatLocal gives "Sat, Aug 1, 7:00 PM"; take weekday + day number.
    const [weekday, monthDay] = formatLocal(first.utcInstant, this.viewerTz).split(', ');
    return `${weekday} ${monthDay?.split(' ')[1] ?? ''}`.trim();
  }

  /** Clock time for a row, e.g. "7:00 PM". */
  timeLabel(block: GridBlock): string {
    return formatTime(block.utcInstant, this.viewerTz);
  }

  selectedCountForDay(date: string): number {
    const blocks = this.blocksByDate.get(date);
    if (!blocks) return 0;
    let count = 0;
    for (const b of blocks) if (this.selected.has(b.blockId)) count++;
    return count;
  }

  goToDay(index: number): void {
    if (index < 0 || index >= this.colDates.length) return;
    this.activeDayIndex = index;
    // A range can only span one day, so leaving it armed across a day change
    // would make the next tap fill a range the user never started.
    this.rangeAnchorId = null;
  }

  // ── Range tap ──────────────────────────────────────────────────────
  // Tapping every block individually is the real cost of answering on a phone:
  // a 5-day poll with 30-minute slots over a 4-hour window is ~40 taps. Tap a
  // start, tap an end, and everything between fills — 2 taps per day.

  /** The row awaiting a second tap to close a range, if any. */
  rangeAnchorId: string | null = null;

  get rangeAnchorLabel(): string {
    const block = this.activeDayBlocks.find((b) => b.blockId === this.rangeAnchorId);
    return block ? this.timeLabel(block) : '';
  }

  /**
   * The phone list's tap handler. Distinct from onCellClick (the desktop grid's
   * plain toggle) because a range only makes sense in a single ordered column
   * of times.
   */
  onTimeRowClick(blockId: string): void {
    if (this.readOnly) return;
    if (this.swipeConsumed) {
      this.swipeConsumed = false;
      return;
    }

    // Tapping something already picked always just un-picks it. That keeps a
    // mistap cheap to undo, and doubles as the way to cancel a pending range
    // (the anchor is itself selected).
    if (this.selected.has(blockId)) {
      this.rangeAnchorId = null;
      this.selected.delete(blockId);
      this.manualSelected.delete(blockId);
      this.emitSelection();
      return;
    }

    const day = this.activeDayBlocks;
    const anchorIdx = this.rangeAnchorId ? day.findIndex((b) => b.blockId === this.rangeAnchorId) : -1;
    const targetIdx = day.findIndex((b) => b.blockId === blockId);

    if (anchorIdx !== -1 && targetIdx !== -1) {
      // Order-independent: tapping an earlier time to close the range reads
      // the same to the user as tapping a later one.
      const [lo, hi] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
      for (let i = lo; i <= hi; i++) this.manualSelected.add(day[i].blockId);
      this.rangeAnchorId = null;
      this.applyFilters();
      return;
    }

    this.manualSelected.add(blockId);
    this.rangeAnchorId = blockId;
    this.applyFilters();
  }

  /**
   * Applies the day on screen to every other day, matched on time-of-day.
   * The single biggest saving available: most people's week is the same shape
   * every day, so this turns "set 5 days" into "set 1 day and tap once".
   */
  copyActiveDayToAllDays(): void {
    const times = new Set(
      this.activeDayBlocks
        .filter((b) => this.selected.has(b.blockId))
        .map((b) => b.blockId.split('T')[1]),
    );
    if (times.size === 0) return;
    for (const b of this.blocks) {
      if (times.has(b.blockId.split('T')[1])) this.manualSelected.add(b.blockId);
    }
    this.applyFilters();
  }

  prevDay(): void {
    this.goToDay(this.activeDayIndex - 1);
  }

  nextDay(): void {
    this.goToDay(this.activeDayIndex + 1);
  }

  /** Selects every block on the day currently shown. */
  selectActiveDay(): void {
    for (const b of this.activeDayBlocks) this.manualSelected.add(b.blockId);
    this.applyFilters();
  }

  /** Clears every block on the day currently shown. */
  clearActiveDay(): void {
    for (const b of this.activeDayBlocks) this.manualSelected.delete(b.blockId);
    this.applyFilters();
  }

  get activeDayFullySelected(): boolean {
    const blocks = this.activeDayBlocks;
    return blocks.length > 0 && blocks.every((b) => this.selected.has(b.blockId));
  }

  // ── Swipe between days ─────────────────────────────────────────────
  // The list sets `touch-action: pan-y`, so the browser keeps vertical
  // scrolling (native, and never fought over) while horizontal gestures reach
  // these handlers. That split is the whole point — the old code claimed BOTH
  // axes with `touch-action: none` and broke scrolling entirely.

  private swipeStartX: number | null = null;
  private swipeStartY = 0;
  private swipeConsumed = false;

  onListPointerDown(ev: PointerEvent): void {
    if (!ev.isPrimary) return;
    this.swipeStartX = ev.clientX;
    this.swipeStartY = ev.clientY;
    this.swipeConsumed = false;
  }

  onListPointerUp(ev: PointerEvent): void {
    if (!ev.isPrimary || this.swipeStartX === null) return;
    const dx = ev.clientX - this.swipeStartX;
    const dy = ev.clientY - this.swipeStartY;
    this.swipeStartX = null;

    // Require the gesture to be decisively horizontal. Without the dy
    // comparison a diagonal scroll-flick would also flip the day.
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;

    this.swipeConsumed = true;
    if (dx < 0) this.nextDay();
    else this.prevDay();
  }


  // ── Quick filters ──────────────────────────────────────────────────
  // Toggles rather than one-shot buttons, and they COMBINE across categories:
  // "Weekdays" + "After 5 PM" means weekday evenings, not weekdays plus every
  // evening. Within a category they're a union (Weekdays + Weekends = all
  // days), across categories an intersection -- which is how people read a
  // pair of filters, and the reason a plain union felt wrong.
  //
  // Applying a combination ADDS the matching blocks to the current selection,
  // so hand-painted cells are never wiped out by using a filter.
  /** Which time filters this form offers. Creator-configurable. */
  @Input() set timeFilterIds(ids: TimeFilterId[] | null | undefined) {
    const wanted = ids?.length ? ids : DEFAULT_TIME_FILTER_IDS;
    this.enabledTimeFilters = TIME_FILTERS.filter((f) => wanted.includes(f.id));
  }
  private enabledTimeFilters: TimeFilterOption[] = TIME_FILTERS.filter((f) =>
    DEFAULT_TIME_FILTER_IDS.includes(f.id),
  );

  activeDayFilters = new Set<DayFilterId>();
  activeTimeFilterId: TimeFilterId | null = null;
  /** Cells chosen by hand. Survives filters being toggled on and off. */
  private manualSelected = new Set<string>();

  get timeFilters(): TimeFilterOption[] {
    return this.enabledTimeFilters;
  }

  isDayFilterActive(id: DayFilterId): boolean {
    return this.activeDayFilters.has(id);
  }

  isTimeFilterActive(id: TimeFilterId): boolean {
    return this.activeTimeFilterId === id;
  }

  toggleDayFilter(id: DayFilterId): void {
    if (this.activeDayFilters.has(id)) this.activeDayFilters.delete(id);
    else this.activeDayFilters.add(id);
    this.applyFilters();
  }

  /**
   * Time filters are mutually exclusive -- "after 5" and "after 7" combined
   * would just mean "after 5", so offering them as independent toggles would
   * be a control that silently does nothing.
   */
  toggleTimeFilter(id: TimeFilterId): void {
    this.activeTimeFilterId = this.activeTimeFilterId === id ? null : id;
    this.applyFilters();
  }

  get hasActiveFilters(): boolean {
    return this.activeDayFilters.size > 0 || this.activeTimeFilterId !== null;
  }

  clearFilters(): void {
    this.activeDayFilters.clear();
    this.activeTimeFilterId = null;
  }

  /**
   * Recompute the selection as (hand-painted cells) UNION (filter matches).
   *
   * Filters are a derived layer, not a one-shot fill. If they merely added to
   * the selection, toggling one OFF would visibly do nothing -- which is the
   * opposite of what a toggle means. Keeping the manual set separate means a
   * filter can be removed cleanly without discarding anything painted by hand.
   */
  private applyFilters(): void {
    this.selected = new Set(this.manualSelected);
    if (!this.hasActiveFilters) {
      this.emitSelection();
      return;
    }
    const timeFilter = this.activeTimeFilterId
      ? TIME_FILTERS.find((f) => f.id === this.activeTimeFilterId)
      : null;

    this.addMatching((date, time) => {
      if (this.activeDayFilters.size > 0) {
        const dow = AvailabilityGridComponent.weekdayOf(date);
        const isWeekend = dow === 0 || dow === 6;
        const dayOk =
          (this.activeDayFilters.has('weekdays') && !isWeekend) ||
          (this.activeDayFilters.has('weekends') && isWeekend);
        if (!dayOk) return false;
      }
      // "THH:MM" is zero-padded, so a lexical compare is a valid time test.
      // Overnight tail blocks (00:15) sort below any evening threshold and are
      // correctly excluded.
      if (timeFilter) {
        if (time < timeFilter.fromTime) return false;
        if (timeFilter.untilTime && time >= timeFilter.untilTime) return false;
      }
      return true;
    });
  }

  private addMatching(predicate: (date: string, time: string) => boolean): void {
    for (const block of this.blocks) {
      const [date, time] = block.blockId.split('T');
      if (predicate(date, time)) this.selected.add(block.blockId);
    }
    this.emitSelection();
  }

  private static weekdayOf(date: string): number {
    // getDay() on the poll's calendar date (parsed at local midnight) -- 0=Sun.
    return new Date(`${date}T00:00:00`).getDay();
  }

  selectAll(): void {
    for (const b of this.blocks) this.manualSelected.add(b.blockId);
    this.applyFilters();
  }


  private emitSelection(): void {
    this.selectionChange.emit(Array.from(this.selected));
  }

  private cellFromPoint(x: number, y: number): string | null {
    const target = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!target || !target.classList.contains('paint-cell')) return null;
    return target.getAttribute('data-block-id');
  }

  private paint(blockId: string): void {
    if (blockId === this.lastPaintedKey) return; // avoid redundant work on hover-repeat
    this.lastPaintedKey = blockId;

    if (this.paintMode === 'select') {
      this.selected.add(blockId);
      this.manualSelected.add(blockId);
    } else if (this.paintMode === 'deselect') {
      this.selected.delete(blockId);
      this.manualSelected.delete(blockId);
    }
    this.emitSelection();
  }

  private onPointerDown = (ev: PointerEvent): void => {
    // Only handle the primary pointer -- ignore secondary touches so a
    // second finger landing mid-drag can't hijack the gesture.
    if (!ev.isPrimary) return;

    // Drag-paint is a mouse/pen interaction only. Phones get the day-at-a-time
    // layout instead, but touch TABLETS (577px+) still render this grid, and
    // claiming their touches here would recreate the scroll trap this rebuild
    // exists to remove. They toggle via the cell's own click handler; see the
    // matching coarse-pointer `touch-action` rule on .grid.
    if (ev.pointerType === 'touch') return;

    const blockId = this.cellFromPoint(ev.clientX, ev.clientY);
    if (!blockId) return;

    ev.preventDefault();
    this.dragging = true;
    this.paintMode = this.isSelected(blockId) ? 'deselect' : 'select';
    this.lastPaintedKey = null;
    this.pointerJustHandled = true;

    try {
      (ev.target as Element).closest('.grid')?.setPointerCapture(ev.pointerId);
    } catch {
      /* no-op -- capture is an optimization, not a correctness requirement */
    }

    this.paint(blockId);
  };

  private onPointerMove = (ev: PointerEvent): void => {
    if (!this.dragging || !ev.isPrimary) return;
    ev.preventDefault();

    const blockId = this.cellFromPoint(ev.clientX, ev.clientY);
    if (!blockId) return;
    this.paint(blockId);
  };

  private onPointerUp = (ev: PointerEvent): void => {
    if (!ev.isPrimary) return;
    this.dragging = false;
    this.paintMode = null;
    this.lastPaintedKey = null;
  };
}
