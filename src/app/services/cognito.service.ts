import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, from, map } from 'rxjs';
import { signIn, signOut, fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';

export interface XomUser {
  userId: string;
  username: string;
  email?: string;
}

/**
 * Wraps Amplify v6 Auth APIs for the SHARED `xomware_users` Cognito pool,
 * via the `cognito_client_xomforms` app client (deployed in
 * xomware-infrastructure -- see docs/features/xomforms/PLAN.md). Ported
 * from xomware-frontend's cognito.service.ts, the actual live Cognito
 * reference in this app family -- xomify-frontend predates the Cognito
 * migration and has no Cognito integration to mirror.
 *
 * Trimmed for xomforms' MVP scope: sign-in only, no local sign-up/
 * password-reset UI (a creator with an existing Xomware account -- from
 * xomware.com or any other app on the shared pool -- can already sign in
 * here; new-account creation is out of scope for Phase 3).
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

  signIn(email: string, password: string): Observable<XomUser> {
    return from(this.signInInternal(email, password));
  }

  private async signInInternal(email: string, password: string): Promise<XomUser> {
    const result = await signIn({ username: email, password });
    if (!result.isSignedIn) {
      throw new Error(result.nextStep?.signInStep ?? 'SIGN_IN_INCOMPLETE');
    }
    return this.refreshUser();
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
