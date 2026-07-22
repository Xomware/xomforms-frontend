import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { CognitoService } from '../../services/cognito.service';

/**
 * Anonymous landing (route `''`). Two clear doors:
 *   1. Sign in / sign up with Google (shared Cognito Hosted UI, reused from
 *      the auth work in PR #3).
 *   2. Open a form by link/key — a respondent pastes a form link or types a
 *      key/id and is routed to the PUBLIC guest form view (`/f/:id`), no
 *      account required.
 *
 * Signed-in users never see this: as soon as the shared session resolves we
 * redirect to `/dashboard`. Mirrors the SSO carry-over pattern in
 * sign-in.component so the first paint doesn't flash the wrong screen.
 */
@Component({
  selector: 'app-landing',
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.scss'],
})
export class LandingComponent implements OnInit, OnDestroy {
  /** Held true until the initial session check settles, to avoid a flash. */
  resolving = true;
  loading = false;
  formKey = '';
  keyError = '';
  authError = '';

  private sub?: Subscription;

  constructor(
    private cognito: CognitoService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.sub = this.cognito.isReady$
      .pipe(
        filter((ready) => ready),
        take(1),
      )
      .subscribe(() => {
        if (this.cognito.isAuthenticated()) {
          this.router.navigateByUrl('/dashboard');
          return;
        }
        this.resolving = false;
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  onGoogleSignIn(): void {
    if (this.loading) return;
    this.loading = true;
    this.authError = '';
    this.startRedirect(() => this.cognito.signInWithGoogle());
  }

  onHostedUiSignIn(): void {
    if (this.loading) return;
    this.loading = true;
    this.authError = '';
    this.startRedirect(() => this.cognito.signInWithHostedUi());
  }

  /**
   * Resolve whatever the respondent pasted into a form key and route to the
   * public guest view. Accepts a raw key/id OR a full/partial link
   * containing `/f/<key>` or the legacy `/poll/<key>`.
   */
  openForm(): void {
    const key = this.extractKey(this.formKey);
    if (!key) {
      this.keyError = 'Enter a form key or paste a form link.';
      return;
    }
    this.keyError = '';
    this.router.navigate(['/f', key]);
  }

  onKeyInput(): void {
    if (this.keyError) this.keyError = '';
  }

  private extractKey(raw: string): string {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return '';

    // Pull out the segment after `/f/` or the legacy `/poll/` if a link was
    // pasted; otherwise treat the whole value as the key. Strip any trailing
    // query string or hash so `?t=...` tracking tokens (a later feature) or
    // `#anchor`s don't leak into the id.
    const match = trimmed.match(/\/(?:f|poll)\/([^/?#\s]+)/i);
    const candidate = match ? match[1] : trimmed;
    return candidate.split(/[?#\s]/)[0];
  }

  private startRedirect(start: () => Observable<void>): void {
    // After auth we want signed-in users on their dashboard; stash it the
    // same way sign-in.component does so it survives the Hosted UI round-trip.
    try {
      sessionStorage.setItem('xf_next', '/dashboard');
    } catch {
      /* private mode / storage disabled — falls back to home, which then
         redirects an authed user to /dashboard anyway. */
    }
    start().subscribe({
      // On success the browser navigates away to the Hosted UI.
      error: () => {
        this.loading = false;
        this.authError = 'Could not start sign-in. Please try again.';
      },
    });
  }
}
