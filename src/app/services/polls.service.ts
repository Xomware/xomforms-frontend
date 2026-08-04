import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  CreatePollRequest,
  FinalizeResult,
  Poll,
  PollListResponse,
  ResultsVisibility,
  LocationType,
} from '../models/poll.model';

/** Creator-editable settings. Every field optional -- omitted means unchanged. */
export interface UpdatePollSettings {
  title?: string;
  description?: string;
  guestAllowed?: boolean;
  resultsVisibility?: ResultsVisibility;
  allowResponseEdits?: boolean;
  quickFilters?: string[];
  instructions?: string;
  locationType?: LocationType | null;
  locationName?: string | null;
  locationAddress?: string | null;
  locationUrl?: string | null;
  locationLat?: number | null;
  locationLon?: number | null;
}

/**
 * Poll create/get/list. Maps to xomforms-backend's polls_create (authed),
 * polls_get (public), polls_list (authed) handlers.
 */
@Injectable({ providedIn: 'root' })
export class PollsService {
  private readonly baseUrl = `${environment.apiBaseUrl}/polls`;

  constructor(private http: HttpClient) {}

  /** POST /polls/create -- authed, creator only. */
  create(req: CreatePollRequest): Observable<Poll> {
    return this.http.post<Poll>(`${this.baseUrl}/create`, req);
  }

  /** GET /polls/get -- public read, no auth required. */
  get(pollId: string): Observable<Poll> {
    const params = new HttpParams().set('pollId', pollId);
    return this.http.get<Poll>(`${this.baseUrl}/get`, { params });
  }

  /** GET /polls/list -- authed, "my polls" via the creator GSI. */
  list(): Observable<PollListResponse> {
    return this.http.get<PollListResponse>(`${this.baseUrl}/list`);
  }

  /**
   * POST /polls/delete -- authed, creator only. Irreversible: removes the poll
   * AND every response submitted to it. POST (not DELETE) to match the rest of
   * the mutating routes.
   */
  delete(pollId: string): Observable<{ pollId: string; deletedResponses: number }> {
    return this.http.post<{ pollId: string; deletedResponses: number }>(
      `${this.baseUrl}/delete`,
      { pollId },
    );
  }

  /** POST /polls/close -- authed, creator only. Stops new responses, keeps existing. */
  close(pollId: string): Observable<Poll> {
    return this.http.post<Poll>(`${this.baseUrl}/close`, { pollId });
  }

  /** POST /polls/close with reopen -- clears closeAt so the form accepts responses again. */
  reopen(pollId: string): Observable<Poll> {
    return this.http.post<Poll>(`${this.baseUrl}/close`, { pollId, reopen: true });
  }

  /**
   * POST /polls/finalize -- authed, creator only. Records the winning time,
   * closes the form, and emails everyone who answered.
   *
   * `notify: false` lets a creator correct a mistaken pick without mailing
   * everyone a second time.
   */
  finalize(pollId: string, blockId: string, notify = true): Observable<FinalizeResult> {
    return this.http.post<FinalizeResult>(`${this.baseUrl}/finalize`, {
      pollId,
      blockId,
      notify,
    });
  }

  /**
   * Public .ics download for a finalized form. Unauthenticated by design so it
   * opens straight from a mail client, which is where the link lives.
   */
  icsUrl(pollId: string): string {
    return `${this.baseUrl}/ics?pollId=${encodeURIComponent(pollId)}`;
  }

  /**
   * POST /polls/update -- authed, creator only. Partial: only the supplied
   * settings are written, so toggling one can't clobber another.
   *
   * Settings only. The grid config (dates, window, granularity, fields) is
   * deliberately not editable -- changing it under respondents who already
   * answered would invalidate their submissions.
   */
  update(pollId: string, changes: UpdatePollSettings): Observable<Poll> {
    return this.http.post<Poll>(`${this.baseUrl}/update`, { pollId, ...changes });
  }
}
