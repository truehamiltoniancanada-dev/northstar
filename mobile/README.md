# Sentryharbor Mobile

Expo React Native app for Sentryharbor on iOS and Android.

## What it does

- Connects to the existing Sentryharbor API.
- Supports verification-code sign-in.
- Shows the membership offer: one week free trial, then $19/month.
- Lets members choose Coach W, Coach H, or Coach O.
- Loads saved chat history and sends chat messages through the existing backend.
- Adds optional voice input and text-to-speech playback.
- Keeps Sentryharbor safety language visible: emotional support, not therapy, diagnosis, or emergency care.

## API base URL

Default:

```bash
https://api.sentryharbor.com/api
```

Override locally:

```bash
EXPO_PUBLIC_API_BASE_URL=https://api.sentryharbor.com/api npm start
```

## Local development

```bash
cd mobile
npm install
npm start
```

Then open the app in Expo Go or an Expo development build.

## Voice support

Voice input uses `expo-speech-recognition`.

Text-to-speech playback uses `expo-speech`.

If speech recognition is unavailable on a device, the app falls back to text input and remains fully usable.

## iOS and Android identifiers

```text
iOS bundle ID: com.sentryharbor.app
Android package: com.sentryharbor.app
```

## EAS builds

Install and authenticate EAS CLI:

```bash
npm install -g eas-cli
eas login
```

Configure the project:

```bash
cd mobile
eas init
```

Replace `replace-with-eas-project-id` in `app.json` after `eas init`.

Build:

```bash
eas build --platform ios --profile production
eas build --platform android --profile production
```

Submit:

```bash
eas submit --platform ios --profile production
eas submit --platform android --profile production
```

## Store/payment note

The app opens the existing web checkout for membership. Before App Store / Play Store submission, review Apple and Google rules for digital subscriptions. Some app categories must use in-app purchases instead of Stripe checkout.

## Required smoke tests

- Sign in with verification code.
- Confirm membership gate appears for non-members.
- Open checkout.
- Refresh membership after checkout.
- Choose each coach.
- Send and receive a chat message.
- Load chat history.
- Test voice input permission and fallback.
- Test coach reply playback.
- Confirm crisis escalation copy appears when backend returns `escalated=true`.
- Confirm no outdated branding or old pricing copy appears.
