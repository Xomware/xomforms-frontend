import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { CognitoService } from '../../../services/cognito.service';

/**
 * Landing route after the Cognito Hosted UI / Google redirect. Amplify
 * processes the auth code internally and emits `signInWithRedirect` /
 * `signedIn` via Hub; we wait for the user observable to populate, then
 * route to the original target (`?next=`) or home. Mirrors
 * xomware-frontend's callback component.
 */
@Component({
  selector: 'app-callback',
  templateUrl: './callback.component.html',
  styleUrls: ['./callback.component.scss'],
})
export class CallbackComponent implements OnInit, OnDestroy {
  errored = false;
  private sub?: Subscription;
  private timer?: ReturnType<typeof setTimeout>;
  private nextPath = '/';

  constructor(
    private cognito: CognitoService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    // Recover the pre-redirect target stashed by the sign-in page (the Hosted
    // UI round-trip strips query params from our original URL). Fall back to
    // an explicit `?next=` if present.
    let target = this.route.snapshot.queryParamMap.get('next') ?? '';
    try {
      target = sessionStorage.getItem('xf_next') ?? target;
      sessionStorage.removeItem('xf_next');
    } catch {
      /* storage unavailable -- default to home */
    }
    if (target) {
      const decoded = target.startsWith('%') ? decodeURIComponent(target) : target;
      if (decoded.startsWith('/') && !decoded.startsWith('//')) {
        this.nextPath = decoded;
      }
    }

    this.sub = this.cognito.user$.subscribe((user) => {
      if (user) this.router.navigateByUrl(this.nextPath);
    });

    // Fallback if the redirect never resolves into a session.
    this.timer = setTimeout(() => {
      if (!this.cognito.currentUser) this.errored = true;
    }, 8000);
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    if (this.timer) clearTimeout(this.timer);
  }
}
