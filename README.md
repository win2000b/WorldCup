# Family World Cup Sweepstake

A mobile-first site that shows fixtures in date order, team ownership, UK kickoff times, match status, results, and watch channels.

## What to edit first

1. Update owner names in data/owners.json.
2. Update team-owner mapping in data/teams.json using your real sweepstake list.
3. Replace fixtures in data/fixtures.json with your tournament schedule.

## Fixture model

Each fixture supports fixed teams and unresolved knockout slots.

- TEAM slot example:
  - { "type": "TEAM", "teamId": "ENG", "label": "England" }
- QUALIFIER slot example:
  - { "type": "QUALIFIER", "qualifierKey": "WINNER_GROUP_A", "label": "Winner Group A" }
- WINNER_OF_MATCH slot example:
  - { "type": "WINNER_OF_MATCH", "matchRef": "QF1", "label": "Winner QF1" }

All kickoff times are stored in UTC in fixtures and displayed in UK time (Europe/London) in the UI.

## Channel data

- Use channel and secondaryChannel per fixture for manual channel assignment.
- If the results API returns channel fields, those override manual values.
- If no channel is available, the UI shows TBC.

## Local run

Use any static server, for example:

- npx serve .

Open the displayed local URL.

## Deploy to Vercel

1. Import this folder into Vercel.
2. Set environment variables:
   - RESULTS_PROVIDER = football-data or api-football
   - FOOTBALL_DATA_API_KEY when using football-data
   - API_FOOTBALL_KEY when using api-football
3. Deploy.

The frontend calls /api/results and gracefully falls back to static data if no API key is configured.

## Notes on API limits

- Vercel Hobby and free football APIs have request limits.
- This app caches merged fixtures in localStorage to reduce repeated calls.
