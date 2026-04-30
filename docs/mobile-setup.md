# Nova Mobile Setup (Flutter + Firebase)

This guide explains what is required to run the mobile app with chat streaming and push notifications.

## Required IDs

- Android package id: `one.aml.nova.nova_mobile_companion`
- iOS bundle id: `one.aml.nova.novamobilecompanion`

Your Firebase project must include app registrations for both ids above.

## Required files (local only, do not commit)

Place these files in `api_keys/` at the repository root:

- `google-services.json` (Android Firebase app config)
- `GoogleService-Info.plist` (iOS Firebase app config)
- Firebase Admin SDK JSON service account key  
  (example: `nova-b006d-firebase-adminsdk-<id>.json`)

`api_keys/` is ignored by git.

## Copy Firebase mobile config files into the app

From repo root:

### Android

Copy:

- `api_keys/google-services.json`

To:

- `apps/mobile_flutter/android/app/google-services.json`

### iOS

Copy:

- `api_keys/GoogleService-Info.plist`

To:

- `apps/mobile_flutter/ios/Runner/GoogleService-Info.plist`

Then open iOS project in Xcode and ensure `GoogleService-Info.plist` is included under `Runner` target resources.

## Backend environment setup

Create `.env` from `.env.example` and set:

- `NOVA_FIREBASE_ADMIN_CREDENTIALS_PATH`  
  absolute or repo-relative path to your Admin SDK JSON key
- `NOVA_API_TOKEN` and `NOVA_SETTINGS_SECRET` to strong values

## Start backend

```powershell
corepack pnpm --filter @nova/agent-core dev
```

## Run Flutter app

```powershell
cd apps/mobile_flutter
flutter pub get
```

### Android emulator

```powershell
flutter run --dart-define=NOVA_API_BASE_URL=http://10.0.2.2:8787
```

### iOS simulator

```powershell
flutter run --dart-define=NOVA_API_BASE_URL=http://127.0.0.1:8787
```

## Verify push end-to-end

1. Login in mobile app.
2. App registers device token via `/v1/mobile/push/register`.
3. Trigger test push:
   - backend endpoint: `POST /v1/mobile/push/test`
4. Trigger real events:
   - security approval pending
   - update check with available update
   - approval action

## Security notes

- Never commit service account keys or Firebase app config files.
- Rotate Admin SDK keys if they were ever exposed.
- Keep production keys separate from development keys.
