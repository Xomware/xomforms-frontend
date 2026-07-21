// Local dev environment -- gitignored (matches xomify-frontend's
// environment.dev.ts convention: developers create their own local copy
// with real values). Fill in cognitoUserPoolId/cognitoClientId locally
// from `aws ssm get-parameter --name /xomware/shared/cognito/...` to test
// against the live shared pool + live xomforms API during `ng serve`.
export const environment = {
  production: false,
  apiBaseUrl: 'https://api.xomforms.xomware.com',
  awsRegion: 'us-east-1',
  cognitoUserPoolId: '',
  cognitoClientId: '',
  cognitoDomain: 'xomware-auth.auth.us-east-1.amazoncognito.com',
};
