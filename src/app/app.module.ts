import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

import { PollCreateComponent } from './components/poll-create/poll-create.component';
import { AvailabilityGridComponent } from './components/availability-grid/availability-grid.component';
import { OverlapHeatmapComponent } from './components/overlap-heatmap/overlap-heatmap.component';
import { PollViewComponent } from './components/poll-view/poll-view.component';
import { SignInComponent } from './components/auth/sign-in/sign-in.component';
import { CallbackComponent } from './components/auth/callback/callback.component';

import { jwtInterceptor } from './interceptors/jwt.interceptor';

@NgModule({
  declarations: [
    AppComponent,
    PollCreateComponent,
    AvailabilityGridComponent,
    OverlapHeatmapComponent,
    PollViewComponent,
    SignInComponent,
    CallbackComponent,
  ],
  imports: [BrowserModule, AppRoutingModule, FormsModule, ReactiveFormsModule],
  // provideHttpClient(withInterceptors(...)) is the correct way to register
  // a functional HttpInterceptorFn even in an NgModule app -- mirrors
  // xomware-frontend's app.module.ts exactly.
  providers: [provideHttpClient(withInterceptors([jwtInterceptor]))],
  bootstrap: [AppComponent],
})
export class AppModule {}
