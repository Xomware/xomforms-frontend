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
}
