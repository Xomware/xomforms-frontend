export const environment = {
  production: true,
  // Live custom domain, verified against the deployed API Gateway base
  // path mapping (api.xomforms.xomware.com -> REST API gdtrxxuqn4, stage
  // dev) during Phase 2 infra verification -- not a guess.
  apiBaseUrl: 'https://api.xomforms.xomware.com',
  awsRegion: 'us-east-1',
  // Cognito pool/client id are public-by-design (frontend bundles ship
  // them) but injected at deploy time from SSM rather than hardcoded here
  // -- mirrors xomware-frontend's deploy-frontend.yml pattern exactly, so
  // a pool/client change never requires an application-code change.
  cognitoUserPoolId: '',
  cognitoClientId: '',
  cognitoDomain: 'xomware-auth.auth.us-east-1.amazoncognito.com',
};
