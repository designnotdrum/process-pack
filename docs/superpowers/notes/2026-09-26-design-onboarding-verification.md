# Design onboarding verification evidence, 2026-09-26

## Jev client, live calls

- **TypeSafe route, run 2026-09-26.** State: a two-line diff adding a heading to `app/page.tsx`. Question: one `noul`, "This text describes a change to a user interface." Result: `{"source": "typesafe", "answers": {"ui": {"type": "noul", "noul": 0.96}}, "reason": null}`.
- **OpenRouter route: not run live.** No `OPENROUTER_API_KEY` in the laptop shell, and 1Password was not signed in (`op whoami`: "account is not signed in"). The route is covered by the stubbed self-test only.
