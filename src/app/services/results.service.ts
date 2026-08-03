import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { FormResult, OverlapResult } from '../models/response.model';

/**
 * Poll results (overlap heatmap + best time). Maps to xomforms-backend's
 * results_get (authed, creator-only) and results_get_public (public,
 * gated by showResultsToRespondents) handlers -- see the split rationale
 * at the top of xomforms-infrastructure/terraform/lambda.tf.
 *
 * `pollForCreator`/`pollPublic` re-fetch every ~10-15s for a live feel
 * per the plan (MVP uses interval polling, not websockets -- v2 concern).
 */
/**
 * How a respondent identifies themselves to the public results route. Guests
 * present the id their browser generated at submit time; signed-in callers
 * present the email they submitted under (that route has no authorizer).
 */
export interface ResultsIdentity {
  guestId?: string | null;
  email?: string | null;
}

function withIdentity(pollId: string, identity?: ResultsIdentity): HttpParams {
  let params = new HttpParams().set('pollId', pollId);
  if (identity?.guestId) params = params.set('guestId', identity.guestId);
  else if (identity?.email) params = params.set('email', identity.email);
  return params;
}

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

  /**
   * GET /results/get-public -- public, respondent/guest view, single fetch.
   *
   * `identity` tells the backend who is asking, so a form set to
   * "after they respond" can confirm the caller actually answered. The gate
   * itself lives on the server; this just supplies the claim. Omitting it on
   * such a form yields a 403, which is the correct outcome.
   */
  getPublic(pollId: string, identity?: ResultsIdentity): Observable<OverlapResult> {
    return this.http.get<OverlapResult>(`${this.baseUrl}/get-public`, {
      params: withIdentity(pollId, identity),
    });
  }

  /** Re-fetches the creator view every ~10-15s. Caller must unsubscribe on destroy. */
  pollForCreator(pollId: string): Observable<OverlapResult> {
    return timer(0, this.POLL_INTERVAL_MS).pipe(switchMap(() => this.getForCreator(pollId)));
  }

  /** Re-fetches the public/respondent view every ~10-15s. Caller must unsubscribe on destroy. */
  pollPublic(pollId: string, identity?: ResultsIdentity): Observable<OverlapResult> {
    return timer(0, this.POLL_INTERVAL_MS).pipe(switchMap(() => this.getPublic(pollId, identity)));
  }

  // ── Q&A form results ────────────────────────────────────────────────
  // Same routes as the scheduler results; the backend returns a FormResult
  // (per-field tallies) instead of an OverlapResult for a qa poll.

  /** GET /results/get for a qa poll -- authed, creator-only, single fetch. */
  getFormForCreator(pollId: string): Observable<FormResult> {
    const params = new HttpParams().set('pollId', pollId);
    return this.http.get<FormResult>(`${this.baseUrl}/get`, { params });
  }

  /** GET /results/get-public for a qa poll -- respondent/guest view. */
  getFormPublic(pollId: string, identity?: ResultsIdentity): Observable<FormResult> {
    return this.http.get<FormResult>(`${this.baseUrl}/get-public`, {
      params: withIdentity(pollId, identity),
    });
  }

  /** Re-fetches the creator's qa results every ~10-15s. Caller must unsubscribe. */
  pollFormForCreator(pollId: string): Observable<FormResult> {
    return timer(0, this.POLL_INTERVAL_MS).pipe(switchMap(() => this.getFormForCreator(pollId)));
  }

  /** Re-fetches the public qa results every ~10-15s. Caller must unsubscribe. */
  pollFormPublic(pollId: string, identity?: ResultsIdentity): Observable<FormResult> {
    return timer(0, this.POLL_INTERVAL_MS).pipe(
      switchMap(() => this.getFormPublic(pollId, identity)),
    );
  }
}
