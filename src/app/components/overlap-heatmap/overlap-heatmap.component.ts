import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { OverlapResult, BlockTally } from '../../models/response.model';
import {
  formatDayLong,
  formatDuration,
  formatLocal,
  formatTime,
  viewerTimeZone,
} from '../../models/grid.util';

interface HeatCell extends BlockTally {
  /** Everyone available -- the "lock it in" state that must visually pop. */
  isFull: boolean;
  /** 1-2 people short of everyone -- a secondary "so close" highlight. */
  isNearMiss: boolean;
  /** How many people are missing (total - count). */
  short: number;
  /** Part of the best contiguous start window of the event's length. */
  inBestWindow: boolean;
  /** The starting slot of a best window (gets the "start here" marker). */
  isWindowStart: boolean;
}

interface HeatRow {
  label: string;
  cells: HeatCell[];
}

interface LegendStop {
  count: number;
  opacity: number;
}

/**
 * Read-only overlap results: a plain-language BEST-TIME hero, an event-length
 * line, a labelled density heatmap (with a legend + per-cell counts), a
 * distinct "everyone's free" treatment, and secondary "so close" highlights.
 *
 * Driven directly by xomforms-backend's OverlapResult. The window fields
 * (slotCount / bestWindowStartIds / bestWindowCount / eventDurationMinutes)
 * are optional: when talking to a backend deployed before they existed, the
 * component gracefully falls back to the single best block.
 */
@Component({
  selector: 'app-overlap-heatmap',
  templateUrl: './overlap-heatmap.component.html',
  styleUrls: ['./overlap-heatmap.component.scss'],
})
export class OverlapHeatmapComponent implements OnChanges {
  @Input() result: OverlapResult | null = null;

  rows: HeatRow[] = [];
  colDates: string[] = [];
  legendStops: LegendStop[] = [];
  readonly viewerTz = viewerTimeZone();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['result']) {
      this.rebuild();
    }
  }

  // ── Derived summary state ──────────────────────────────────────────
  get total(): number {
    return this.result?.totalRespondents ?? 0;
  }

  get hasResponses(): boolean {
    return this.total > 0;
  }

  /** slotCount from the backend, or 1 (single-slot event) as a safe fallback. */
  get slotCount(): number {
    return this.result?.slotCount && this.result.slotCount > 0 ? this.result.slotCount : 1;
  }

  get isMultiSlot(): boolean {
    return this.slotCount > 1;
  }

  get eventDurationMinutes(): number | null {
    return this.result?.eventDurationMinutes ?? null;
  }

  get durationLabel(): string {
    const mins = this.eventDurationMinutes;
    return mins ? formatDuration(mins) : '';
  }

  /** Best window start blockIds, falling back to the best single block(s). */
  private get bestStartIds(): string[] {
    const windowIds = this.result?.bestWindowStartIds;
    if (windowIds && windowIds.length > 0) return windowIds;
    return this.result?.bestBlockIds ?? [];
  }

  /** Headcount free for the whole best window, falling back to the block count. */
  get bestCount(): number {
    if (this.result?.bestWindowCount != null && (this.result?.bestWindowStartIds?.length ?? 0) > 0) {
      return this.result.bestWindowCount;
    }
    const firstBest = this.bestStartIds[0];
    const tally = this.result?.blocks.find((b) => b.blockId === firstBest);
    return tally?.count ?? 0;
  }

  get everyoneFree(): boolean {
    return this.hasResponses && this.bestCount === this.total;
  }

  /** How many alternative best start times exist beyond the one we headline. */
  get tiedAlternatives(): number {
    return Math.max(0, this.bestStartIds.length - 1);
  }

  // ── Best-time hero, in words ───────────────────────────────────────
  get bestDayLabel(): string {
    const start = this.startTally(this.bestStartIds[0]);
    return start ? formatDayLong(start.utcInstant, this.viewerTz) : '';
  }

  get bestTimeRangeLabel(): string {
    const startId = this.bestStartIds[0];
    const start = this.startTally(startId);
    if (!start) return '';

    const endInstant = this.bestWindowEndInstant(startId);
    if (!endInstant) return formatTime(start.utcInstant, this.viewerTz);

    const startLabel = formatTime(start.utcInstant, this.viewerTz);
    const endLabel = formatTime(endInstant.toISOString(), this.viewerTz);
    const nextDay = this.crossesMidnight(start.utcInstant, endInstant.toISOString());
    return `${startLabel} – ${endLabel}${nextDay ? ' (next day)' : ''}`;
  }

  /**
   * End instant of the best window = start + eventDuration (for a multi-slot
   * window, the end of its final slot; for a single-slot event, one slot after
   * the start). Returns null when the start block can't be resolved.
   */
  private bestWindowEndInstant(startId: string): Date | null {
    const start = this.startTally(startId);
    if (!start) return null;

    if (!this.isMultiSlot) {
      const end = new Date(start.utcInstant);
      end.setMinutes(end.getMinutes() + this.slotMinutes());
      return end;
    }

    const members = this.windowMemberIds(startId);
    const lastId = members[members.length - 1];
    const last = this.result?.blocks.find((b) => b.blockId === lastId);
    if (!last) return null;
    const end = new Date(last.utcInstant);
    end.setMinutes(end.getMinutes() + this.slotMinutes());
    return end;
  }

  /** True when start and end fall on different calendar days in the viewer tz. */
  private crossesMidnight(startInstant: string, endInstant: string): boolean {
    return formatDayLong(startInstant, this.viewerTz) !== formatDayLong(endInstant, this.viewerTz);
  }

  get bestAvailabilityLabel(): string {
    if (!this.hasResponses) return '';
    if (this.everyoneFree) {
      return `all ${this.total} available`;
    }
    return `${this.bestCount} of ${this.total} available`;
  }

  private startTally(blockId: string | undefined): BlockTally | undefined {
    if (!blockId) return undefined;
    return this.result?.blocks.find((b) => b.blockId === blockId);
  }

  // ── Grid + legend construction ─────────────────────────────────────
  private rebuild(): void {
    if (!this.result) {
      this.rows = [];
      this.colDates = [];
      this.legendStops = [];
      return;
    }

    const dateSet = new Set<string>();
    const timeSet = new Set<string>();
    for (const block of this.result.blocks) {
      const [date, time] = block.blockId.split('T');
      dateSet.add(date);
      timeSet.add(time);
    }
    this.colDates = Array.from(dateSet).sort();
    const times = Array.from(timeSet).sort();

    const windowMembers = this.allWindowMemberIds();
    const startIdSet = new Set(this.bestStartIds);
    const byBlockId = new Map(this.result.blocks.map((b) => [b.blockId, b] as const));
    const total = this.total;

    this.rows = times.map((time) => {
      const cells: HeatCell[] = this.colDates
        .map((date) => byBlockId.get(`${date}T${time}`))
        .filter((b): b is BlockTally => !!b)
        .map((b) => {
          const short = total - b.count;
          return {
            ...b,
            isFull: total > 0 && b.count === total,
            isNearMiss: total >= 4 && b.count > 0 && (short === 1 || short === 2),
            short,
            inBestWindow: windowMembers.has(b.blockId),
            isWindowStart: startIdSet.has(b.blockId),
          };
        });
      const label =
        cells.length > 0
          ? formatLocal(cells[0].utcInstant, this.viewerTz).split(', ').slice(-1)[0]
          : time;
      return { label, cells };
    });

    // Legend: an ascending set of density stops from 1..total (capped to a
    // readable number of swatches for large groups).
    this.legendStops = [];
    if (total > 0) {
      const maxStops = 6;
      const step = total <= maxStops ? 1 : Math.ceil(total / maxStops);
      for (let c = step; c < total; c += step) {
        this.legendStops.push({ count: c, opacity: this.opacityFor(c, total) });
      }
    }
  }

  // ── Window helpers ─────────────────────────────────────────────────
  private slotMinutes(): number {
    if (this.eventDurationMinutes && this.slotCount > 0) {
      return this.eventDurationMinutes / this.slotCount;
    }
    // Infer from the first two consecutive blocks that share a date.
    const blocks = this.result?.blocks ?? [];
    for (let i = 0; i < blocks.length - 1; i++) {
      if (blocks[i].blockId.split('T')[0] === blocks[i + 1].blockId.split('T')[0]) {
        const diff =
          (new Date(blocks[i + 1].utcInstant).getTime() - new Date(blocks[i].utcInstant).getTime()) /
          60000;
        if (diff > 0) return diff;
      }
    }
    return 60;
  }

  /** The member blockIds of the window that STARTS at startId (same day only). */
  private windowMemberIds(startId: string): string[] {
    const blocks = this.result?.blocks ?? [];
    const startIdx = blocks.findIndex((b) => b.blockId === startId);
    if (startIdx < 0) return startId ? [startId] : [];

    const day = startId.split('T')[0];
    const members: string[] = [];
    for (let i = startIdx; i < blocks.length && members.length < this.slotCount; i++) {
      if (blocks[i].blockId.split('T')[0] !== day) break;
      members.push(blocks[i].blockId);
    }
    return members;
  }

  private allWindowMemberIds(): Set<string> {
    const all = new Set<string>();
    for (const startId of this.bestStartIds) {
      for (const id of this.windowMemberIds(startId)) all.add(id);
    }
    return all;
  }

  // ── Cell rendering ─────────────────────────────────────────────────
  private opacityFor(count: number, total: number): number {
    if (total <= 0) return 0.06;
    // Floor of 0.06 so a zero-count cell still reads as "on the grid".
    return 0.06 + (count / total) * 0.94;
  }

  cellOpacity(cell: HeatCell): number {
    return this.opacityFor(cell.count, this.total);
  }

  cellTitle(cell: HeatCell): string {
    const when = formatLocal(cell.utcInstant, this.viewerTz);
    if (this.total === 0) return `${when} — no responses yet`;
    return `${when} — ${cell.count} of ${this.total} available`;
  }

  colHeaderLabel(date: string): string {
    const rep = this.result?.blocks.find((b) => b.blockId.startsWith(date));
    return rep
      ? formatLocal(rep.utcInstant, this.viewerTz).split(',').slice(0, 2).join(',')
      : date;
  }
}
