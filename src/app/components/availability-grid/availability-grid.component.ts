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
    if (this.pointerJustHandled) {
      this.pointerJustHandled = false;
      return;
    }
    if (this.selected.has(blockId)) {
      this.selected.delete(blockId);
    } else {
      this.selected.add(blockId);
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
    this.emitSelection();
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
    } else if (this.paintMode === 'deselect') {
      this.selected.delete(blockId);
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
