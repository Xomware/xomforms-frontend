import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { FormInvite } from '../models/poll.model';

/** One recipient to invite. `name` personalises the greeting when supplied. */
export interface InviteRecipient {
  email: string;
  name?: string | null;
}

export interface SendInvitesResult {
  pollId: string;
  sent: number;
  failed: number;
  results: FormInvite[];
}

/**
 * Form invites. Maps to xomforms-backend's invites_send / invites_list
 * handlers, both creator-only.
 *
 * The backend mails each recipient individually and reports per-recipient
 * status rather than failing the batch, so a single bad address is visible
 * without losing the rest of the send.
 */
@Injectable({ providedIn: 'root' })
export class InvitesService {
  private readonly baseUrl = `${environment.apiBaseUrl}/invites`;

  constructor(private http: HttpClient) {}

  /** POST /invites/send -- authed, creator only. */
  send(
    pollId: string,
    recipients: InviteRecipient[],
    senderName?: string,
  ): Observable<SendInvitesResult> {
    return this.http.post<SendInvitesResult>(`${this.baseUrl}/send`, {
      pollId,
      recipients,
      senderName,
    });
  }

  /** GET /invites/list -- authed, creator only. */
  list(pollId: string): Observable<{ pollId: string; invites: FormInvite[] }> {
    return this.http.get<{ pollId: string; invites: FormInvite[] }>(`${this.baseUrl}/list`, {
      params: { pollId },
    });
  }
}
