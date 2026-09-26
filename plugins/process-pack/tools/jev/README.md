# jev_client

Asks Jev, TypeSafe's model, named questions over a text state. The design onboarding checks use it: the review gate's second check, the second opinion on an existing UI's branch, and the taste check on direction mocks.

## Routes

The client picks a route by which key is set in the environment.

1. **`TYPESAFE_API_KEY` set.** `POST https://api.typesafe.ai/v1/systemone` with `{"model": "jev-latest", "state", "questions"}`. The probabilities are Jev's own.
2. **Only `OPENROUTER_API_KEY` set.** OpenRouter chat completions with model `typesafe/jev-router`. OpenRouter lists that model as a router that uses Jev to pick a model and reasoning effort for each request. It has no `noul` or `choice` question types, so the client asks for a JSON reply in the same shape. The probabilities are the routed model's own estimate, not Jev's.
3. **Neither key set.** No request is made.

Every call on routes 1 and 2 is billed.

## Failure

The client never raises. A missing key, a timeout, an HTTP error, or a malformed reply returns `source: "none"` with the reason, and the caller carries on without Jev. Every answer is checked before it is returned: probabilities must be between 0 and 1, and a `choice` must be one of its question's options.

## What is sent

`prepare_state` drops diff sections for `.env` files, `secrets/` directories, and lockfiles, then caps the state at 8192 bytes.

## Questions and answers

A question is `{"type": "noul", "instructions": "..."}` or `{"type": "choice", "instructions": "...", "criteria": {"<option>": "<when it fits>"}}`. These are the shapes Meridian's `scripts/lane-label.ts` sends.

The result is `{"source": "typesafe" | "openrouter" | "none", "answers": {...}, "reason": null | "..."}`. A `noul` answer is `{"type": "noul", "noul": 0.82}`. A `choice` answer is `{"type": "choice", "choice": "<option>", "probabilities": {...}, "confidence": 0.7}`.

Keep the `source` with every stored answer, so results from the two routes are never compared as if they were the same measurement.

## Use

```bash
python3 jev_client.py ask --state-file diff.txt --questions-file questions.json
python3 jev_client.py --dry-run
```

The CLI prints the result as JSON and always exits 0. The dry run starts a local stub server and checks both routes, the no-key case, timeouts, HTTP errors, malformed replies, and the state limits.
