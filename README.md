# Paper Trail

**Assertion-level claim triage.** Paste a headline, a forwarded message, or a press line, and it comes apart into the separate things it is actually asserting — each one marked for what it would take to check.

Most misleading text is not a single false statement. It is one real finding carrying three claims it does not support. Paper Trail makes that structure visible: the passage is highlighted span by span, and every assertion gets its own verdict, the specific weasel word or missing baseline named, and the one efficient thing a reader could do to settle it.

---

## What it does

- **Decomposes** a passage into non-overlapping, verbatim assertion spans
- **Classifies** each span — checkable, unverifiable, disputed, misleading, false, rhetoric, opinion
- **Flags load-bearing claims** — the ones whose failure collapses the whole point
- **Names the rhetorical moves** with verbatim quotes (causal slide, no-true-Scotsman, and so on)
- **Renders a receipt** — a composition meter, the marked-up passage, numbered assertion rows, and a "check it yourself" list

It does not claim to be a fact-checker against live sources. It is a *structural* analysis: what is being asserted, and what class of evidence would settle each piece.

---

## Stack

| Layer | What |
|---|---|
| Frontend | One static `index.html` — no build step, no framework |
| Backend | One Vercel serverless function (`api/analyze.js`, Node 18+) |
| Model | Anthropic Messages API |

The API key lives only in the serverless environment. The browser never sees it.

---

## Deploy to Vercel

### Option A — via GitHub (recommended)

```bash
git init
git add .
git commit -m "Paper Trail"
git branch -M main
git remote add origin https://github.com/<you>/paper-trail.git
git push -u origin main
```

Then at [vercel.com/new](https://vercel.com/new):

1. Import the repo.
2. **Framework Preset:** `Other`. Leave build & output settings empty — there is no build step.
3. Add an environment variable:
   - Name: `ANTHROPIC_API_KEY`
   - Value: your key from [console.anthropic.com](https://console.anthropic.com/settings/keys)
   - Environments: tick **Production**, **Preview**, and **Development**
4. Deploy.

### Option B — via CLI

```bash
npm i -g vercel
vercel                                  # link the project
vercel env add ANTHROPIC_API_KEY        # paste the key, select all environments
vercel --prod
```

### After deploying

If you add the key *after* the first deploy, redeploy so the function picks it up:
Vercel → Deployments → ⋯ → **Redeploy**.

---

## Run locally

```bash
cp .env.example .env.local     # put your real key in it
npx vercel dev                 # serves index.html and /api/analyze together
```

Opening `index.html` directly from the filesystem will render the page but `/api/analyze` will 404 — the serverless function needs `vercel dev` (or a deploy) to exist.

---

## Project layout

```
paper-trail/
├── index.html          the whole frontend — markup, styles, logic
├── api/
│   └── analyze.js      POST { text } -> assertion breakdown JSON
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

---

## API

**`POST /api/analyze`**

```json
{ "text": "A new study proves that…" }
```

**200**

```json
{
  "verdict_line": "One real finding is doing the work of three claims it does not support.",
  "confidence": "medium",
  "assertions": [
    {
      "text": "verbatim span from the input",
      "verdict": "unverifiable",
      "load_bearing": true,
      "label": "Unverifiable as written",
      "note": "No study is named, so the figure cannot be traced.",
      "check": "The citation: which study, what sample size, what baseline."
    }
  ],
  "devices": [
    { "name": "Causal slide", "quote": "which is why", "effect": "Turns correlation into a stated reason." }
  ],
  "to_check": ["Ask for the study by name."]
}
```

**Errors** return `{ code, error }`. Codes the frontend handles: `no_key`, `rate_limited`, `too_long`, `bad_json`, `upstream`.

Each `assertions[].text` is guaranteed to be a verbatim substring of the input — that is what lets the frontend highlight the original passage rather than reprinting a paraphrase.

---

## Design notes

- **Theme-aware** — full light and dark palettes, defined as tokens, honouring both `prefers-color-scheme` and an explicit `data-theme` stamp.
- **Opens at rest** — the page loads showing a worked example, clearly flagged, so its purpose reads before anyone types.
- **Sequenced reveal** — assertion highlights light up in order, so the passage visibly comes apart. Respects `prefers-reduced-motion`.
- **Graceful degradation** — a missing key, a rate limit, or a malformed reply each produce specific, actionable copy rather than a dead button.

---

## Limits

- 6,000 character cap per passage.
- Structural analysis, not source verification — it tells you what would settle a claim, not whether the claim is true.
- Judgements come from a language model and should be read as a prompt to check, not a ruling.
