# Changelog

This document tracks notable application milestones. The version matches `package.json`; no published GitHub Release is implied.

## 1.0.0 — 14 October 2026

### Added

- Independent Express / TypeScript REST API backed by MongoDB and Mongoose.
- Persistent MongoDB sessions, administrator authentication, session protection and logout.
- Doctor and patient endpoints with strict validation, pagination, filtering and bounded prefix search.
- Database-side analytics and indexed query strategies.
- Real-MongoDB integration tests with Vitest and a reproducible local launcher.
- Render deployment and public health endpoint for the DoctorTracker live demonstration.

### Documentation

- API endpoint reference, architecture and authorization model.
- Deployment and environment guides; synthetic-data boundaries.
- Indexed search query-plan evidence.
