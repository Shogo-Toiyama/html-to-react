# model-lab

Tries the workshop's AI steps (components, props, tailwind, tailwind-cleanup) with
different Claude models, **without touching `frontend/`**. It reuses the real prompts
(`frontend/server/prompts.ts`) and the real validator (`frontend/server/validate.ts`).

1. `npm install`
2. Put your key in `model-lab/.env`: `ANTHROPIC_API_KEY=sk-ant-...`
3. `npm run baseline` — Sonnet runs the four steps in a row on the sample site (acm-design).
   Each step's input is saved, so every model gets exactly the same input.
4. `npm run try -- --model haiku` — Haiku on the same inputs.
   Options: `--steps components,tailwind-cleanup`, `--runs 3` (LLM output varies; repeat it).
5. `npm run report` — table of result, time, cost and similarity to Sonnet.

Results are in `runs/<model>/<step>-<n>/project`. To check the page itself:
`cd runs/claude-haiku-5-5/3-tailwind-1/project && npm install && npm run dev`.

The table tells you whether the answer passed the validator (ids, classes, syntax, imports)
and how many files match Sonnet's. It can't tell whether the page looks the same; that is
the part to check by eye, mostly for the `tailwind` step.

Differences from production: the safety fallback model is off (so results come from the
tested model), and there is no rate limiting. Prompt, schema, `effort: medium` and the one
fix-up round are the same.
