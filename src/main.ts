import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { Amplify } from 'aws-amplify';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';

// Configure Amplify Auth once at bootstrap, against the SHARED
// xomware_users pool via the cognito_client_xomforms app client. Empty
// config values mean local dev without auth wired up -- Amplify will
// throw on use, which is expected (matches xomware-frontend's main.ts).
if (environment.cognitoUserPoolId && environment.cognitoClientId) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: environment.cognitoUserPoolId,
        userPoolClientId: environment.cognitoClientId,
        loginWith: {
          oauth: {
            domain: environment.cognitoDomain,
            scopes: ['email', 'openid', 'profile'],
            redirectSignIn: [`${window.location.origin}/auth/callback`],
            redirectSignOut: [window.location.origin],
            responseType: 'code',
          },
        },
      },
    },
  });
}

platformBrowserDynamic()
  .bootstrapModule(AppModule, { ngZoneEventCoalescing: true })
  .catch((err) => console.error(err));
