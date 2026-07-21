import { Component } from '@angular/core';
import { CognitoService } from './services/cognito.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  title = 'xomforms-frontend';

  constructor(public cognito: CognitoService) {}

  signOut(): void {
    this.cognito.signOut().subscribe({
      // Hub's `signedOut` event clears the user; nothing else to do here.
      error: () => {
        /* sign-out is best-effort — a network blip shouldn't strand the UI */
      },
    });
  }
}
