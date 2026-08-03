import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AnswerValue,
  SubmitAnswersRequest,
  SubmitAnswersResult,
  SubmitAvailabilityRequest,
  SubmitAvailabilityResult,
} from '../models/response.model';
import {
  ClaimResult,
  RespondedForm,
  RespondedFormsResponse,
} from '../models/poll.model';
import { CognitoService } from './cognito.service';

const GUEST_ID_STORAGE_KEY = 'xomforms_guest_id';

/**
 * Submit availability. Routes to the authed or public backend route
 * depending on whether the caller is signed in -- NOT on the poll's
 * guestAllowed flag alone (a signed-in creator/respondent should always
 * submit under their real identity, even on a guestAllowed poll).
 *
 * Maps to xomforms-backend's responses_submit_authed (email-keyed) and
 * responses_submit_public (guest#<uuid>-keyed, gated by guestAllowed)
 * handlers.
 */
@Injectable({ providedIn: 'root' })
export class ResponsesService {
  private readonly baseUrl = `${environment.apiBaseUrl}/responses`;

  constructor(
    private http: HttpClient,
    private cognito: CognitoService,
  ) {}

  /**
   * Submits availability for the given poll. When signed in, posts to the
   * authed route under the caller's real email. When signed out, posts to
   * the public guest route -- caller is responsible for only offering this
   * path when the poll's `guestAllowed` is true (the backend also
   * enforces this with a 403, so this is UX, not the security boundary).
   */
  submit(
    pollId: string,
    displayName: string,
    blocks: string[],
  ): Observable<SubmitAvailabilityResult> {
    const isAuthed = this.cognito.isAuthenticated();
    const body: SubmitAvailabilityRequest = { pollId, displayName, blocks };

    if (isAuthed) {
      return this.http.post<SubmitAvailabilityResult>(`${this.baseUrl}/submit`, body);
    }

    body.guestId = this.getOrCreateGuestId();
    return this.http.post<SubmitAvailabilityResult>(`${this.baseUrl}/submit-guest`, body);
  }

  /**
   * Submits Q&A answers for a form-type poll. Same authed/guest routing as
   * submit() -- the backend branches on the poll's formType and validates
   * each answer against the poll's declared fields.
   */
  submitAnswers(
    pollId: string,
    displayName: string,
    answers: Record<string, AnswerValue>,
  ): Observable<SubmitAnswersResult> {
    const isAuthed = this.cognito.isAuthenticated();
    const body: SubmitAnswersRequest = { pollId, displayName, answers };

    if (isAuthed) {
      return this.http.post<SubmitAnswersResult>(`${this.baseUrl}/submit`, body);
    }

    body.guestId = this.getOrCreateGuestId();
    return this.http.post<SubmitAnswersResult>(`${this.baseUrl}/submit-guest`, body);
  }

  /**
   * Best-effort guest identity (locked MVP decision: name-only, no
   * Cognito signup for guests). Persisted in localStorage so a returning
   * guest on the SAME browser upserts their prior response instead of
   * creating a duplicate row -- a guest on a different browser/device is
   * a known, accepted limitation (see plan Risks).
   */
  /**
   * Forms the signed-in caller has responded to. Backs the dashboard's
   * "Responded" tab.
   */
  mine(): Observable<RespondedFormsResponse> {
    return this.http.get<RespondedFormsResponse>(`${this.baseUrl}/mine`);
  }

  /**
   * The caller's own response to one form, for prefilling the edit view.
   *
   * Two routes, because a guest has no JWT and the public route has no
   * authorizer context to read an identity from: signed-in callers use the
   * authed /mine?pollId, guests present the guestId their browser already
   * holds.
   */
  myResponseFor(pollId: string): Observable<{ response: RespondedForm | null }> {
    if (this.cognito.isAuthenticated()) {
      return this.http.get<{ response: RespondedForm | null }>(`${this.baseUrl}/mine`, {
        params: { pollId },
      });
    }
    return this.http.get<{ response: RespondedForm | null }>(`${this.baseUrl}/get-mine`, {
      params: { pollId, guestId: this.getOrCreateGuestId() },
    });
  }

  /**
   * Link responses submitted from this browser as a guest to the account that
   * just signed in. No stored guest id means there is nothing to claim.
   */
  claimGuestResponses(): Observable<ClaimResult | null> {
    const guestId = this.peekGuestId();
    if (!guestId) return of(null);
    return this.http.post<ClaimResult>(`${this.baseUrl}/claim`, { guestId });
  }

  /** The identifier a guest submitted under, for the results gate. */
  guestIdIfAny(): string | null {
    return this.peekGuestId();
  }

  /** Reads the stored id WITHOUT minting one -- callers here only want to know. */
  private peekGuestId(): string | null {
    return localStorage.getItem(GUEST_ID_STORAGE_KEY);
  }

  private getOrCreateGuestId(): string {
    const existing = localStorage.getItem(GUEST_ID_STORAGE_KEY);
    if (existing) return existing;

    const fresh =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(GUEST_ID_STORAGE_KEY, fresh);
    return fresh;
  }
}
