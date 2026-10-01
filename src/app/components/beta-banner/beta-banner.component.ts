import { Component } from '@angular/core';

export const BETA_BANNER_STORAGE_KEY = 'xf-beta-banner-dismissed';

@Component({
  selector: 'xf-beta-banner',
  templateUrl: './beta-banner.component.html',
  styleUrls: ['./beta-banner.component.scss'],
})
export class BetaBannerComponent {
  readonly feedbackUrl = 'https://github.com/Xomware/xomforms-frontend/issues';
  dismissed = readDismissed();

  dismiss(): void {
    this.dismissed = true;
    try {
      localStorage.setItem(BETA_BANNER_STORAGE_KEY, '1');
    } catch {
      // Storage is blocked (private mode, disabled site data): the banner just comes back next visit.
    }
  }
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(BETA_BANNER_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
