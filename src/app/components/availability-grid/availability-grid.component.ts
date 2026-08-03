import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { GridBlock } from '../../models/poll.model';
import { formatLocal, viewerTimeZone } from '../../models/grid.util';

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

@Component({
  selector: 'app-availability-grid',
  templateUrl: './availability-grid.component.html',
  styleUrls: ['./availability-grid.component.scss'],
})
export class AvailabilityGridComponent implements OnChanges, AfterViewInit, OnDestroy {
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

  @ViewChild('gridEl', { static: false }) gridEl?: ElementRef<HTMLDivElement>;

  rows: GridRow[] = [];
  colDates: string[] = [];
  selected = new Set<string>();
  readonly viewerTz = viewerTimeZone();

  private dragging = false;
  private paintMode: PaintMode = null;
  private lastPaintedKey: string | null = null;
  private listenersAttached = false;
  private pointerJustHandled = false;

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

  ngAfterViewInit(): void {
    this.attachListeners();
  }

  ngOnDestroy(): void {
    const el = this.gridEl?.nativeElement;
    if (!el) return;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
  }

  private attachListeners(): void {
    // Preview/read-only grids never paint -- skip all pointer wiring.
    if (this.readOnly) return;
    const el = this.gridEl?.nativeElement;
    if (!el || this.listenersAttached) return;
    el.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    el.addEventListener('pointermove', this.onPointerMove, { passive: false });
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    this.listenersAttached = true;
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
