# ClearFlow — Budget Planner

A mobile-first, single-page budget planning web app. No backend, no login, no cost. Runs entirely in your browser and saves automatically.

## Features

- **Multiple bank accounts** — add as many as you need
- **Income tracking** — fixed or variable, weekly/bi-weekly/monthly, Thursday or Friday pay days
- **Expense buckets** — organized into five monthly windows (1–6, 7–12, 13–18, 19–24, 25–end of month)
- **End-of-month handling** — expenses and monthly pay dates on days 29–31 automatically clamp to the last valid day of shorter months
- **One-time expenses** — auto-slotted into the correct week
- **Savings goals** — weekly, bi-weekly, or monthly
- **Transfers** — regular or one-time, between accounts
- **12-week projections** — rolling balance, safe-to-spend headroom, green/red coloring
- **Best/Worst case** — shown when variable income exists
- **Auto-save** — persists in browser localStorage
- **PDF export** — download projection as a file

## Setup (GitHub Pages)

1. Create a new GitHub repository
2. Upload `index.html`, `style.css`, and `engine.js` and `app.js`
3. Go to **Settings → Pages → Source → main branch / root**
4. Your app will be live at `https://yourusername.github.io/your-repo-name`
5. Open that URL on your phone and bookmark it — it works like an app

## File Structure

```
index.html   — Main HTML shell
style.css    — All styles (light theme, mobile-first)
engine.js    — Data model, projection engine, localStorage, 32 unit-test scenarios
app.js       — UI rendering and event handling
```

## Running Tests

Open the browser console and type:
```js
Engine.runTests()
```
This runs 44 arithmetic checks covering: date math, February edge cases, monthly pay-date clamping, pay schedule logic, income calculations, expense bucketing, transfer math, and 12-week projection chaining.

## Data

All data is stored in `localStorage` under the key `clearflow_v1`. To reset, open the browser console and run:
```js
localStorage.removeItem('clearflow_v1'); location.reload();
```
