# Contributing to DoctorTracker API

This repository owns the Express API, Mongoose models, authentication, validation and analytics. The UI lives in [Doctor-Tracker-Portal](https://github.com/sajeeb-ahmeed/Doctor-Tracker-Portal).

## Get started

1. Install Node.js 24 and npm; clone this repository and create a feature branch.
2. Run `npm ci` and `npm run dev:local`. The local launcher starts a real, persisted MongoDB development instance and seeds only **synthetic** records.
3. Before opening a pull request, run:

```bash
npm run check
npm run format:check
npm run build
npm test
```

The integration suite uses its own isolated test database. Never run destructive scripts or automated test fixtures against production MongoDB.

## API and security expectations

- Preserve session-cookie authentication, allowed-origin verification and `X-Requested-With` protection.
- Validate incoming data, keep stable JSON response contracts and enforce administrator authorization.
- Add tests for route, filtering, validation or model changes. Update the endpoint table in the README for API changes.
- Never commit environment files, database connection strings, credentials or personally identifiable health information.

## Pull requests

Describe the reason for the change, API compatibility, test results and any required frontend updates. Keep PRs focused and review database/index effects for new queries. Use the [pull request template](.github/PULL_REQUEST_TEMPLATE.md).

DoctorTracker is a portfolio demonstration with synthetic records, not a certified clinical record system.
