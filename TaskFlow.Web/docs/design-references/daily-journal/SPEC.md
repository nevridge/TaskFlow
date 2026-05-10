# Feature: Daily Journal

## What it does
This is the primary feature for this application going forward. The Daily Journal screen will be where the user lands on as the dashbaord. It will be where the user can manage todos, track daily logs, and add notes to any given day.

## Design Reference
- Mockups: ./screenshots/
- Genereated component: ./journal.jsx
- Styles: ./styles.css

## Integration Points
- This should be the main page that initially loads. It should defatul to todays date. The route should be /journal/{MM-DD-YYYY}
- Data source: ../../../../TaskFlow.Api/

## Acceptance Criteria
- [ ] Renders matching the mockup for both light and dark theme
- [ ] Connects to TaskFlow.Api as needed
- [ ] Handles loading/error states
- [ ] Mobile responsive
