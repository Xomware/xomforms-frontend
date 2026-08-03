import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { LandingComponent } from './components/landing/landing.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { PollCreateComponent } from './components/poll-create/poll-create.component';
import { FormResultsComponent } from './components/form-results/form-results.component';
import { PollViewComponent } from './components/poll-view/poll-view.component';
import { AccountComponent } from './components/account/account.component';
import { SignInComponent } from './components/auth/sign-in/sign-in.component';
import { CallbackComponent } from './components/auth/callback/callback.component';
import { authGuard } from './guards/auth.guard';

/**
 * v2 route tree (see xomforms-v2 BRAINSTORM — Foundation):
 *   ''            landing — two doors (Google sign-in + open-by-key). The
 *                 component itself redirects signed-in users to /dashboard.
 *   /dashboard    "My Forms" (creator-only, authGuard).
 *   /forms/new    create a form (authGuard) — reuses PollCreateComponent.
 *   /forms/:id    creator results view (authGuard) — reuses ResultsService +
 *                 overlap-heatmap.
 *   /f/:pollId    public guest form view (no auth) — reuses PollViewComponent.
 *
 * Legacy paths from before the restructure are redirected so previously
 * shared links keep working. `redirectTo` substitutes the named param.
 */
const routes: Routes = [
  { path: '', component: LandingComponent, pathMatch: 'full' },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'forms/new', component: PollCreateComponent, canActivate: [authGuard] },
  { path: 'forms/:id', component: FormResultsComponent, canActivate: [authGuard] },
  { path: 'account', component: AccountComponent, canActivate: [authGuard] },
  { path: 'f/:pollId', component: PollViewComponent },

  { path: 'auth/sign-in', component: SignInComponent },
  { path: 'auth/callback', component: CallbackComponent },

  // Back-compat redirects for pre-v2 links.
  { path: 'polls/create', redirectTo: 'forms/new', pathMatch: 'full' },
  { path: 'poll/:pollId', redirectTo: 'f/:pollId' },

  { path: '**', redirectTo: '' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
