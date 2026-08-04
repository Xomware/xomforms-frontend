import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

import { LandingComponent } from './components/landing/landing.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { PollCreateComponent } from './components/poll-create/poll-create.component';
import { FormResultsComponent } from './components/form-results/form-results.component';
import { AvailabilityGridComponent } from './components/availability-grid/availability-grid.component';
import { OverlapHeatmapComponent } from './components/overlap-heatmap/overlap-heatmap.component';
import { FieldRendererComponent } from './components/field-renderer/field-renderer.component';
import { FieldResultsComponent } from './components/field-results/field-results.component';
import { QaResultsComponent } from './components/qa-results/qa-results.component';
import { PollViewComponent } from './components/poll-view/poll-view.component';
import { StyledSelectComponent } from './components/styled-select/styled-select.component';
import { StyledDateComponent } from './components/styled-date/styled-date.component';
import { UserMenuComponent } from './components/user-menu/user-menu.component';
import { AccountComponent } from './components/account/account.component';
import { AdminPanelComponent } from './components/admin-panel/admin-panel.component';
import { LocationPickerComponent } from './components/location-picker/location-picker.component';
import { SignInComponent } from './components/auth/sign-in/sign-in.component';
import { CallbackComponent } from './components/auth/callback/callback.component';

import { jwtInterceptor } from './interceptors/jwt.interceptor';

@NgModule({
  declarations: [
    AppComponent,
    LandingComponent,
    DashboardComponent,
    PollCreateComponent,
    FormResultsComponent,
    AvailabilityGridComponent,
    OverlapHeatmapComponent,
    FieldRendererComponent,
    FieldResultsComponent,
    QaResultsComponent,
    PollViewComponent,
    StyledSelectComponent,
    StyledDateComponent,
    UserMenuComponent,
    AccountComponent,
    AdminPanelComponent,
    LocationPickerComponent,
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
