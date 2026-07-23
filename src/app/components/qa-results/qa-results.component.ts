import { Component, Input } from '@angular/core';
import { FormResult } from '../../models/response.model';

/**
 * Presentational wrapper for a Q&A form's analytics: a response-count header
 * plus one <app-field-results> per field. Reused by the creator results route,
 * the post-create live view, and the respondent "submitted" confirmation --
 * the Q&A counterpart to <app-overlap-heatmap>.
 */
@Component({
  selector: 'app-qa-results',
  templateUrl: './qa-results.component.html',
  styleUrls: ['./qa-results.component.scss'],
})
export class QaResultsComponent {
  @Input() result: FormResult | null = null;

  get total(): number {
    return this.result?.totalRespondents ?? 0;
  }

  get hasResult(): boolean {
    return !!this.result;
  }
}
