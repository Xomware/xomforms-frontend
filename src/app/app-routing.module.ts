import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { PollCreateComponent } from './components/poll-create/poll-create.component';
import { PollViewComponent } from './components/poll-view/poll-view.component';
import { SignInComponent } from './components/auth/sign-in/sign-in.component';
import { authGuard } from './guards/auth.guard';

const routes: Routes = [
  { path: '', redirectTo: '/polls/create', pathMatch: 'full' },
  { path: 'auth/sign-in', component: SignInComponent },
  { path: 'polls/create', component: PollCreateComponent, canActivate: [authGuard] },
  { path: 'poll/:pollId', component: PollViewComponent },
  { path: '**', redirectTo: '/polls/create' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
