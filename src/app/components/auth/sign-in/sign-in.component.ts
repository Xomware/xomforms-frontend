import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CognitoService } from '../../../services/cognito.service';

/**
 * Minimal sign-in against the shared xomware_users Cognito pool, via the
 * cognito_client_xomforms app client. Ported/trimmed from
 * xomware-frontend's sign-in.component.ts.
 *
 * No local sign-up UI in this MVP -- a creator with an existing Xomware
 * account (from xomware.com or any other app on the shared pool) can
 * already sign in here; new-account creation is out of Phase 3 scope.
 */
@Component({
  selector: 'app-sign-in',
  templateUrl: './sign-in.component.html',
  styleUrls: ['./sign-in.component.scss'],
})
export class SignInComponent implements OnInit {
  readonly form: FormGroup;
  loading = false;
  errorMessage = '';
  private nextPath = '/';

  constructor(
    private fb: FormBuilder,
    private cognito: CognitoService,
    private router: Router,
    private route: ActivatedRoute,
  ) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
    });
  }

  ngOnInit(): void {
    const raw = this.route.snapshot.queryParamMap.get('next');
    if (raw) {
      const decoded = decodeURIComponent(raw);
      // Only honor app-internal paths to avoid open-redirect via `?next=https://evil.com`.
      if (decoded.startsWith('/') && !decoded.startsWith('//')) {
        this.nextPath = decoded;
      }
    }
  }

  fieldInvalid(name: 'email' | 'password'): boolean {
    const ctrl = this.form.get(name);
    return !!ctrl && ctrl.invalid && (ctrl.dirty || ctrl.touched);
  }

  onSubmit(): void {
    if (this.form.invalid || this.loading) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    const { email, password } = this.form.value as { email: string; password: string };

    this.cognito.signIn(email, password).subscribe({
      next: () => this.router.navigateByUrl(this.nextPath),
      error: (err: Error) => {
        this.loading = false;
        this.errorMessage = this.friendlyError(err);
      },
    });
  }

  private friendlyError(err: Error): string {
    const name = (err as { name?: string }).name || '';
    const msg = err.message || '';
    const both = `${name} ${msg}`;
    if (/NotAuthorizedException|Incorrect/i.test(both)) return 'Email or password is incorrect.';
    if (/UserNotFoundException/i.test(both)) return 'No account found for that email.';
    if (/UserNotConfirmedException/i.test(both)) return 'Please verify your email before signing in.';
    if (/network/i.test(both)) return 'Network error -- check your connection and try again.';
    return msg ? `${name ? name + ': ' : ''}${msg}` : 'Something went wrong. Please try again.';
  }
}
