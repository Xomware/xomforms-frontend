import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { CreatePollRequest, Poll, PollListResponse } from '../models/poll.model';

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
}
