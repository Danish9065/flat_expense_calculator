# SplitMate

SplitMate is a responsive expense-sharing web app for managing group expenses,
balances, settlements, invitations, and activity updates.

## Features

- Email authentication with OTP verification and password recovery
- Invite-based group onboarding and member management
- Shared expense tracking with receipt uploads
- Balance summaries, category charts, and settlement workflows
- Realtime activity notifications
- Admin tools for invitations and group management
- Installable Progressive Web App experience

## Tech Stack

- React 19, TypeScript, and Vite
- Tailwind CSS
- React Router and Recharts
- InsForge database, authentication, storage, and realtime services

## Local Development

Create a `.env.local` file with the required InsForge credentials:

```env
VITE_INSFORGE_URL=
VITE_INSFORGE_ANON_KEY=
```

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

## Verification

```bash
npm run lint
npm run build
```

## Deployment

The included `vercel.json` configures client-side route handling for Vercel.
