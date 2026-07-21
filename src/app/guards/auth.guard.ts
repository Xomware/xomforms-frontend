import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { CognitoService } from '../services/cognito.service';

/**
 * Gate creator routes (poll-create, "my polls") behind a valid Cognito
 * session. Ported from xomware-frontend's cognito-auth.guard.ts.
 *
 * Waits for `CognitoService.isReady$` so the initial paint never flashes
 * protected content before the redirect fires. Anonymous visitors are
 * bounced to `/auth/sign-in?next=<requested-url>`.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const cognito = inject(CognitoService);
  const router = inject(Router);

  await firstValueFrom(cognito.isReady$.pipe(filter((ready) => ready), take(1)));

  if (cognito.isAuthenticated()) {
    return true;
  }

  const next = encodeURIComponent(state.url);
  return router.parseUrl(`/auth/sign-in?next=${next}`);
};
