# xomforms-frontend

> Group availability scheduler — Angular frontend.

## What This Is
Angular SPA for Xomforms. Creator builds a poll; respondents drag-paint
availability on a CSS-grid heatmap; creator sees a live overlap heatmap.
See `docs/features/xomforms/PLAN.md` and `docs/features/xomforms/prototype/`
for the Phase 0 drag-paint prototype this repo's `availability-grid`
component is promoted from.

## Stack
- Angular 18, NgModules, TypeScript strict, SCSS

## Key Commands
```bash
npm start           # dev server
npm run build:prod  # production build
npm test            # unit tests
```

## Project Config
```yaml
pm_tool: github-projects
github_project_number: 2
github_project_owner: Xomware
base_branch: master
test_commands:
  - npm run test -- --watch=false --browsers=ChromeHeadless
```

## Constraints
- No charting/heatmap library — hand-rolled drag-paint grid (Phase 0 de-risked).
- Cognito auth uses the shared `xomware_users` pool via `cognito_client_xomforms` app client (deployed in `xomware-infrastructure`, read back via SSM at deploy time — see `deploy-frontend.yml`).
- API base URL: `https://api.xomforms.xomware.com` (verified live against the deployed API Gateway base path mapping).

## Lessons
