import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { OverlapResult } from '../models/response.model';

/**
 * Poll results (overlap heatmap + best time). Maps to xomforms-backend's
 * results_get (authed, creator-only) and results_get_public (public,
 * gated by showResultsToRespondents) handlers -- see the split rationale
 * at the top of xomforms-infrastructure/terraform/lambda.tf.
 *
 * `pollForCreator`/`pollPublic` re-fetch every ~10-15s for a live feel
 * per the plan (MVP uses interval polling, not websockets -- v2 concern).
 */
@Injectable({ providedIn: 'root' })
export class ResultsService {
  private readonly baseUrl = `${environment.apiBaseUrl}/results`;
  private readonly POLL_INTERVAL_MS = 12_000;

  constructor(private http: HttpClient) {}

  /** GET /results/get -- authed, creator-only, single fetch. */
  getForCreator(pollId: string): Observable<OverlapResult> {
    const params = new HttpParams().set('pollId', pollId);
    return this.http.get<OverlapResult>(`${this.baseUrl}/get`, { params });
  }

  /** GET /results/get-public -- public, respondent/guest view, single fetch. */
  getPublic(pollId: string): Observable<OverlapResult> {
    const params = new HttpParams().set('pollId', pollId);
    return this.http.get<OverlapResult>(`${this.baseUrl}/get-public`, { params });
  }

  /** Re-fetches the creator view every ~10-15s. Caller must unsubscribe on destroy. */
  pollForCreator(pollId: string): Observable<OverlapResult> {
    return timer(0, this.POLL_INTERVAL_MS).pipe(switchMap(() => this.getForCreator(pollId)));
  }

  /** Re-fetches the public/respondent view every ~10-15s. Caller must unsubscribe on destroy. */
  pollPublic(pollId: string): Observable<OverlapResult> {
    return timer(0, this.POLL_INTERVAL_MS).pipe(switchMap(() => this.getPublic(pollId)));
  }
}
