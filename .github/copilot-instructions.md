# Party Night

- Japanese mobile event tool for 13 rookies and 2 instructors. Use npm, React, TypeScript, Vite, Firebase Spark only.
- Do not enable billing, add backend services, deploy to an unrelated Firebase project, or transmit employee information.
- Use nicknames. Public event links are unlisted, not confidential. Firestore denies listing and unauthorized writes.
- Test domain and storage changes with npm test. Run npm run lint, npm run build and npm run test:e2e for user workflows.
- Test Firestore rules with npm run test:rules (Java 21+, demo-party-night emulator only).
- Maintain equal participation, canonical competition ranks for ties, revision conflict detection, unsent input retention and finalized result immutability.
- Keep the local demo separate from cloud data and label its non-shared status clearly.
- Firebase login and project configuration belong to the user. Never request secrets through chat.