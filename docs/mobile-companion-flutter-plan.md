# Nova Mobile Companion App Plan (Flutter)

## Goal
Build a native-feeling Flutter mobile companion for Nova with:
- push alerts
- approval actions
- quick voice commands
- secure account/session management
- realtime status and thought feed visibility

This document is implementation-focused so Copilot can code directly from it.

## Product Scope (MVP -> v2)

### MVP
- Login + session persistence
- Dashboard cards (health, active provider, pending approvals)
- Push notifications for:
  - pending approvals
  - security anomalies
  - update available
- Approval inbox (approve/reject)
- Quick chat with text
- Voice command (press-to-talk) using device STT
- Thought feed (realtime via WebSocket fallback to polling)

### v1.1
- Rich chat bubbles with markdown/code blocks
- Attachment upload (image/video)
- Role-aware UI (admin vs limited)
- Notification settings page

### v2
- Background voice trigger (optional)
- Offline queue + resend
- Local encrypted memory cards editor

## Architecture

### Tech stack
- Flutter stable (latest)
- State management: Riverpod
- Networking: Dio
- Realtime: `web_socket_channel`
- Push:
  - Firebase Cloud Messaging (Android/iOS)
  - APNs config for iOS through Firebase
- Local storage:
  - `flutter_secure_storage` for tokens
  - `isar` or `sqflite` for cached feed/chat
- Audio:
  - STT plugin (`speech_to_text`)
  - TTS optional (`flutter_tts`)

### Backend integration assumptions
- Existing Nova HTTP API remains primary.
- Add/confirm these endpoints for mobile:
  - `POST /v1/auth/login`
  - `GET /v1/auth/me`
  - `GET /v1/system/health/full`
  - `GET /v1/approvals`
  - `POST /v1/approvals/approve`
  - `POST /v1/chat/stream`
  - `GET /v1/thoughts`
  - `WS /v1/thoughts/ws`
  - `POST /v1/mobile/push/register` (new)
  - `DELETE /v1/mobile/push/register/:id` (new)

## Security Model

### Authentication
- Use email/password login through Nova auth API.
- Store session token only in secure storage.
- Rotate session token on explicit refresh/login.
- Auto-logout on repeated 401.

### Transport
- Require HTTPS for production.
- Certificate pinning for production builds.
- Reject cleartext HTTP except local dev flavor.

### Data at rest
- Encrypt sensitive local cache fields.
- Never log auth token or API secrets.

## Mobile Push Design

### Device registration
1. App obtains FCM token.
2. App calls `POST /v1/mobile/push/register` with:
   - user id/session context
   - platform
   - token
   - app version
3. Backend stores token and user mapping.

### Push event types
- `approval.pending`
- `security.alert`
- `learning.report.ready`
- `update.available`

Payload schema:
```json
{
  "type": "approval.pending",
  "title": "Approval required",
  "body": "Command requires admin review",
  "entityId": "approval-id",
  "severity": "high",
  "createdAt": "2026-04-30T10:00:00Z"
}
```

### Notification tap routing
- `approval.pending` -> Approval Details page
- `security.alert` -> Security page filtered by alert ID
- `update.available` -> System status page

## App Module Plan

### 1) Core Shell
- `main.dart` app bootstrap
- flavor config (dev/staging/prod)
- theme + dark mode
- route table

### 2) Auth Module
- login screen
- secure token store
- auth guard middleware
- logout and token revoke flow

### 3) Dashboard Module
- health summary card
- pending approvals count
- provider/model runtime status
- quick actions

### 4) Approvals Module
- list + detail
- approve/reject action buttons
- optimistic UI with rollback on API failure

### 5) Chat Module
- streaming response renderer
- markdown/code rendering
- message send, retry, regenerate
- quick prompt chips

### 6) Voice Module
- press-to-talk capture
- STT transcript insert into chat compose box
- optional TTS playback toggle

### 7) Thoughts Module
- realtime feed via WebSocket
- auto reconnect with backoff
- fallback polling when socket unavailable

### 8) Notifications Module
- FCM token lifecycle
- in-app notification center
- push preferences per event type

## Realtime Behavior

### WebSocket reconnect strategy
- backoff sequence: 1s, 2s, 5s, 10s, 20s (max 20s)
- reset backoff on successful connection >= 30s
- heartbeat ping every 30s
- stale socket timeout at 70s no message

### Chat stream parser
- parse SSE events from `/v1/chat/stream`
- handle:
  - `start`
  - `token`
  - `done`
  - `error`
- robustly process fragmented packets and multi-line data frames

## Data Models (Flutter)

- `Session`
  - token, userId, email, expiresAt
- `ApprovalItem`
  - id, riskLevel, command, status, createdAt
- `ThoughtEvent`
  - id, category, title, content, createdAt
- `ChatMessage`
  - id, role, content, stats, attachments
- `NotificationPref`
  - eventType, enabled

## Delivery Plan (Sprints)

### Sprint 1
- Project scaffold
- auth + secure storage
- dashboard + approvals list
- basic push registration

### Sprint 2
- streaming chat
- voice press-to-talk
- thought feed websocket
- notification tap routing

### Sprint 3
- offline cache
- retry/reconnect hardening
- instrumentation + crash reporting
- app store readiness checklist

## QA/Test Plan

### Unit tests
- auth repository
- SSE parser
- websocket reconnect state machine
- notification router

### Integration tests
- login -> dashboard load
- receive push -> deep link route
- approve action -> backend reflected
- stream chat happy + error paths

### Manual tests
- foreground/background push behavior
- network loss recovery
- token expiry and re-login UX
- microphone permission denied path

## Observability

- app analytics events:
  - login_success/fail
  - stream_start/done/error
  - approval_action
  - push_open
- crash logging with breadcrumb trail
- API latency metrics per endpoint

## Acceptance Criteria

- User can login and stay signed in securely.
- User receives push for pending approvals and can open/act from mobile.
- Chat streams live token-by-token.
- Voice quick command can submit text to chat.
- Thought feed updates in near realtime.
- Reconnect and failure states are user-friendly and recover automatically.
