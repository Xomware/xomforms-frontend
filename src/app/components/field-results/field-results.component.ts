import { Component, Input } from '@angular/core';
import { FieldResult } from '../../models/response.model';

interface Bar {
  label: string;
  count: number;
  ratio: number;
  /** Percentage width string, e.g. "42%". Floored to 2% so a >0 bar is visible. */
  width: string;
  pct: string;
  isTop: boolean;
}

/**
 * Per-field analytics for one Q&A field, rendered as hand-rolled CSS bars --
 * the same tally-without-a-charting-library pattern the overlap-heatmap uses
 * (purple density ramp via --xf-heat-rgb). Choice/dropdown fields render one
 * horizontal bar per option; scale fields render a per-value histogram plus a
 * mean/min/max summary line. No charting dependency (hard repo constraint).
 */
@Component({
  selector: 'app-field-results',
  templateUrl: './field-results.component.html',
  styleUrls: ['./field-results.component.scss'],
})
export class FieldResultsComponent {
  @Input() result!: FieldResult;

  get isScale(): boolean {
    return this.result?.type === 'scale';
  }

  get isMulti(): boolean {
    return this.result?.type === 'multi_choice';
  }

  get answered(): number {
    return this.result?.totalResponses ?? 0;
  }

  get hasResponses(): boolean {
    return this.answered > 0;
  }

  get meanLabel(): string {
    const mean = this.result?.mean;
    return mean != null ? (Math.round(mean * 100) / 100).toString() : '—';
  }

  /** Choice/dropdown option bars, highest-count first for scannability. */
  get optionBars(): Bar[] {
    const options = this.result?.options ?? [];
    const maxCount = options.reduce((m, o) => Math.max(m, o.count), 0);
    return options.map((o) => ({
      label: o.label,
      count: o.count,
      ratio: o.ratio,
      width: this.barWidth(o.ratio),
      pct: this.pct(o.ratio),
      isTop: maxCount > 0 && o.count === maxCount,
    }));
  }

  /** Scale histogram bars, in ascending value order (a real distribution). */
  get scaleBars(): Bar[] {
    const buckets = this.result?.buckets ?? [];
    const maxCount = buckets.reduce((m, b) => Math.max(m, b.count), 0);
    return buckets.map((b) => ({
      label: b.value.toString(),
      count: b.count,
      ratio: b.ratio,
      width: this.barWidth(b.ratio),
      pct: this.pct(b.ratio),
      isTop: maxCount > 0 && b.count === maxCount,
    }));
  }

  private barWidth(ratio: number): string {
    if (ratio <= 0) return '0%';
    // Floor so a single vote is still a visible sliver, not a hairline.
    return `${Math.max(2, Math.round(ratio * 100))}%`;
  }

  private pct(ratio: number): string {
    return `${Math.round(ratio * 100)}%`;
  }
}
