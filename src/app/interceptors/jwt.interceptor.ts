import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap } from 'rxjs';
import { CognitoService } from '../services/cognito.service';
import { environment } from '../../environments/environment';

/**
 * Attaches the Cognito ID token as a Bearer header on calls to the
 * xomforms API. Ported from xomware-frontend's jwt.interceptor.ts.
 *
 * Safe to attach on public (NONE-authorization) routes too -- the backend
 * API Gateway never invokes the custom authorizer for those regardless of
 * what headers are sent, so this doesn't need per-route awareness. When
 * signed out, `getJwt()` resolves null and the request goes through
 * unmodified (which is what public routes need, and what authed routes
 * correctly 401 on).
 */
export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiBaseUrl)) {
    return next(req);
  }

  const cognito = inject(CognitoService);
  return from(cognito.getJwt()).pipe(
    switchMap((token) => {
      if (!token) {
        return next(req);
      }
      const authed = req.clone({
        setHeaders: { Authorization: `Bearer ${token}` },
      });
      return next(authed);
    }),
  );
};
