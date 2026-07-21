import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { CognitoService } from '../../../services/cognito.service';

/**
 * Sign-in / sign-up entry for Xomforms. Auth runs through the SHARED
 * Cognito Hosted UI (same pool + domain as xomware.com), so:
 *   - A user already signed into another Xomware app is carried over here
 *     silently -- we short-circuit to `next` as soon as the session check
 *     settles, without ever showing a credential prompt.
 *   - Otherwise we offer "Continue with Google" (Google IdP) as the primary
 *     path and a generic Hosted UI fallback (email / another account).
 * There is no local password form -- sign-up happens on first Google/Hosted
 * UI use. Mirrors xomware-frontend's Google IdP UX.
 */
@Component({
  selector: 'app-sign-in',
  templateUrl: './sign-in.component.html',
  styleUrls: ['./sign-in.component.scss'],
})
export class SignInComponent implements OnInit, OnDestroy {
  loading = false;
  errorMessage = '';
  private nextPath = '/';
  private sub?: Subscription;

  constructor(
    private cognito: CognitoService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    const raw = this.route.snapshot.queryParamMap.get('next');
    if (raw) {
      const decoded = decodeURIComponent(raw);
      // Only honor app-internal paths to avoid open-redirect via `?next=https://evil.com`.
      if (decoded.startsWith('/') && !decoded.startsWith('//')) {
        this.nextPath = decoded;
      }
    }

    // SSO carry-over: if the shared session already resolved into a signed-in
    // user, don't make them click anything -- go straight to the target.
    this.sub = this.cognito.isReady$
      .pipe(
        filter((ready) => ready),
        take(1),
      )
      .subscribe(() => {
        if (this.cognito.isAuthenticated()) {
          this.router.navigateByUrl(this.nextPath);
        }
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  onGoogleSignIn(): void {
    this.redirect(() => this.cognito.signInWithGoogle());
  }

  onHostedUiSignIn(): void {
    this.redirect(() => this.cognito.signInWithHostedUi());
  }

  private redirect(start: () => Observable<void>): void {
    if (this.loading) return;
    this.loading = true;
    this.errorMessage = '';
    // The Hosted UI round-trip drops our `?next=`, so stash it for the
    // callback to pick up (survives the full-page redirect via sessionStorage).
    try {
      sessionStorage.setItem('xf_next', this.nextPath);
    } catch {
      /* private mode / storage disabled -- fall back to home after auth */
    }
    start().subscribe({
      // On success the browser navigates away to the Hosted UI; nothing to do.
      error: (err: Error) => {
        this.loading = false;
        this.errorMessage = this.friendlyError(err);
      },
    });
  }

  private friendlyError(err: Error): string {
    const msg = err?.message || '';
    if (/not configured|Amplify has not been configured/i.test(msg)) {
      return 'Sign-in is not available in this environment yet.';
    }
    if (/network/i.test(msg)) {
      return 'Network error -- check your connection and try again.';
    }
    return 'Could not start sign-in. Please try again.';
  }
}
