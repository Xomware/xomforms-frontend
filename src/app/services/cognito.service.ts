import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, from, map } from 'rxjs';
import {
  signOut,
  fetchAuthSession,
  getCurrentUser,
  signInWithRedirect,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';

export interface XomUser {
  userId: string;
  username: string;
  email?: string;
}

/**
 * Wraps Amplify v6 Auth APIs for the SHARED `xomware_users` Cognito pool,
 * via the `cognito_client_xomforms` app client (deployed in
 * xomware-infrastructure -- see docs/features/xomforms/PLAN.md). Mirrors
 * xomware-frontend's cognito.service.ts, the live Cognito reference in this
 * app family.
 *
 * Auth is done entirely through the SHARED Cognito Hosted UI (same domain +
 * pool as xomware.com). Two consequences we rely on:
 *   - SSO carry-over: a user already signed into any Xomware app has a live
 *     Hosted UI session cookie on the shared domain, so a redirect here
 *     issues a fresh code for the xomforms app client WITHOUT re-prompting
 *     for credentials.
 *   - Sign-up == sign-in: the Google IdP (and Hosted UI) provision a new
 *     account on first use, so there's no separate local sign-up flow.
 */
@Injectable({ providedIn: 'root' })
export class CognitoService implements OnDestroy {
  private readonly userSubject = new BehaviorSubject<XomUser | null>(null);
  private readonly readySubject = new BehaviorSubject<boolean>(false);
  private hubSub?: () => void;

  readonly user$: Observable<XomUser | null> = this.userSubject.asObservable();
  readonly isAuthenticated$: Observable<boolean> = this.user$.pipe(map((u) => !!u));
  /**
   * Emits `true` once the initial session check has settled. Route guards
   * wait on this so the first paint never flashes protected content
   * before a redirect fires.
   */
  readonly isReady$: Observable<boolean> = this.readySubject.asObservable();

  constructor() {
    this.bootstrap();

    this.hubSub = Hub.listen('auth', ({ payload }) => {
      switch (payload.event) {
        case 'signedIn':
        case 'signInWithRedirect':
        case 'tokenRefresh':
          this.refreshUser();
          break;
        case 'signedOut':
          this.userSubject.next(null);
          break;
      }
    });
  }

  ngOnDestroy(): void {
    this.hubSub?.();
  }

  get currentUser(): XomUser | null {
    return this.userSubject.value;
  }

  /** Synchronous check used by route guards after `isReady$` resolves. */
  isAuthenticated(): boolean {
    return this.userSubject.value !== null;
  }

  private async bootstrap(): Promise<void> {
    try {
      await this.refreshUser();
    } catch {
      // No session is fine -- userSubject is already null.
    } finally {
      this.readySubject.next(true);
    }
  }

  /**
   * Kick off Google sign-in/sign-up through the shared Cognito Hosted UI.
   * First-time users are auto-provisioned on the shared pool; returning
   * users (incl. those already signed into another Xomware app) come
   * straight back with a session. The page navigates away, so there's no
   * success value -- completion is handled on /auth/callback via Hub.
   */
  signInWithGoogle(): Observable<void> {
    return from(signInWithRedirect({ provider: 'Google' }).then(() => undefined));
  }

  /**
   * Redirect to the shared Cognito Hosted UI without forcing a provider.
   * This is the true SSO carry-over path: if a Hosted UI session cookie
   * already exists (from xomware.com or any sibling app), Cognito returns a
   * code immediately with no credential prompt. Otherwise the Hosted UI
   * offers Google + email sign-in/sign-up.
   */
  signInWithHostedUi(): Observable<void> {
    return from(signInWithRedirect().then(() => undefined));
  }

  signOut(): Observable<void> {
    return from(
      signOut().then(() => {
        this.userSubject.next(null);
      }),
    );
  }

  /** Returns the current ID token for protected API calls. Null when signed out.
   * IMPORTANT: the ID token, not the access token -- only the ID token
   * carries the `email` claim the xomforms authorizer keys on. */
  async getJwt(): Promise<string | null> {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.idToken?.toString() ?? null;
    } catch {
      return null;
    }
  }

  private async refreshUser(): Promise<XomUser> {
    try {
      const current = await getCurrentUser();
      const session = await fetchAuthSession();
      const claims = session.tokens?.idToken?.payload ?? {};
      const user: XomUser = {
        userId: current.userId,
        username: current.username,
        email: claims['email'] as string | undefined,
      };
      this.userSubject.next(user);
      return user;
    } catch {
      this.userSubject.next(null);
      throw new Error('NO_SESSION');
    }
  }
}
