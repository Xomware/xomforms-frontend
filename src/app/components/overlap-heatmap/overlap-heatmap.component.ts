import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { OverlapResult, BlockTally } from '../../models/response.model';
import { formatLocal, viewerTimeZone } from '../../models/grid.util';

interface HeatmapRow {
  label: string;
  cells: BlockTally[];
}

/**
 * Read-only overlap density grid + best-time banner. Driven directly by
 * xomforms-backend's OverlapResult (results_get / results_get_public) --
 * unlike availability-grid, no client-side grid generation is needed since
 * compute_overlap() already returns every candidate block (including
 * zero-count ones), each with its count/total/ratio.
 */
@Component({
  selector: 'app-overlap-heatmap',
  templateUrl: './overlap-heatmap.component.html',
  styleUrls: ['./overlap-heatmap.component.scss'],
})
export class OverlapHeatmapComponent implements OnChanges {
  @Input() result: OverlapResult | null = null;

  rows: HeatmapRow[] = [];
  colDates: string[] = [];
  readonly viewerTz = viewerTimeZone();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['result']) {
      this.rebuild();
    }
  }

  private rebuild(): void {
    if (!this.result) {
      this.rows = [];
      this.colDates = [];
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

    const byBlockId = new Map(this.result.blocks.map((b) => [b.blockId, b] as const));

    this.rows = times.map((time) => {
      const cells = this.colDates
        .map((date) => byBlockId.get(`${date}T${time}`))
        .filter((b): b is BlockTally => !!b);
      const label = cells.length > 0 ? formatLocal(cells[0].utcInstant, this.viewerTz).split(', ').slice(-1)[0] : time;
      return { label, cells };
    });
  }

  colHeaderLabel(date: string): string {
    const rep = this.result?.blocks.find((b) => b.blockId.startsWith(date));
    return rep ? formatLocal(rep.utcInstant, this.viewerTz).split(',').slice(0, 2).join(',') : date;
  }

  isBest(block: BlockTally): boolean {
    return !!this.result?.bestBlockIds.includes(block.blockId);
  }

  cellOpacity(block: BlockTally): number {
    // Minimum 0.06 so a zero-count cell still reads as "on the grid" rather
    // than invisible; full opacity at ratio 1 (everyone available).
    return 0.06 + block.ratio * 0.94;
  }

  cellTitle(block: BlockTally): string {
    const when = formatLocal(block.utcInstant, this.viewerTz);
    return `${when} -- ${block.count}/${block.total} available`;
  }

  get bestTimesLabel(): string {
    if (!this.result || this.result.bestBlockIds.length === 0) return '';
    const byBlockId = new Map(this.result.blocks.map((b) => [b.blockId, b] as const));
    return this.result.bestBlockIds
      .map((id) => byBlockId.get(id))
      .filter((b): b is BlockTally => !!b)
      .map((b) => formatLocal(b.utcInstant, this.viewerTz))
      .join(' | ');
  }
}
