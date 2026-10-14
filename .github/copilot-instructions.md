# Party Night

- Japanese mobile event tool, default 13 rookies + 2 instructors, configurable 4-64 participants before starting and 1-200 rounds. Use npm, React, TypeScript, Vite, Firebase Spark only.
- Do not enable billing, add backend services, deploy to an unrelated Firebase project, or transmit employee information.
- Use nicknames. Public event links are unlisted, not confidential. Firestore denies listing and unauthorized writes.
- Test domain and storage changes with npm test. Run npm run lint, npm run build and npm run test:e2e for user workflows.
- Test Firestore rules with npm run test:rules (Java 21+, demo-party-night emulator only).
- Prioritize least-scheduled participants. Rank by average points then win rate using exact cross-products; exclude unplayed members. Early finish preserves unrecorded slots; extension must preserve existing rounds/results. Preserve revision conflict detection, unsent input retention and finalized result immutability.
- Keep four players in one horizontal row on mobile and desktop. Support newline bulk name entry and individual editing; never change the roster after starting.
- Keep the local demo separate from cloud data and label its non-shared status clearly.
- Firebase login and project configuration belong to the user. Never request secrets through chat.