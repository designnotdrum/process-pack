#!/usr/bin/env python3
"""
jev_client: ask Jev (TypeSafe's model) named questions over a text state.

Routes, picked by which key is set:
  1. TYPESAFE_API_KEY: POST https://api.typesafe.ai/v1/systemone with
     {"model": "jev-latest", "state", "questions"}. Answers are Jev's own.
  2. Only OPENROUTER_API_KEY: OpenRouter chat completions with model
     typesafe/jev-router, asking for a JSON reply in the same shape. The
     probabilities are the routed model's own estimate, not Jev's.
  3. Neither: no call. source is "none".

Any error (timeout, HTTP error, malformed reply) is treated like route 3, so
a caller never breaks because Jev is unavailable. Every call on routes 1 and
2 is billed.

Standard library only.

CLI:
    jev_client.py ask --state-file <f> --questions-file <json>   (prints JSON, exits 0)
    jev_client.py --dry-run
"""
import fnmatch
import json
import os
import re
import sys
import urllib.error
import urllib.request

TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
STATE_LIMIT_BYTES = 8192
SENSITIVE_PATHS = [
    ".env*", "*/.env*", "*/secrets/*", "secrets/*", "*.pem", "*.key", "*.p12", "*.pfx", "*id_rsa*", "*id_ed25519*",
    ".npmrc", "*/.npmrc", ".pypirc", "*/.pypirc", ".netrc", "*/.netrc", ".dev.vars", "*/.dev.vars", "*.tfvars",
    "*credentials*", "*secret*", "*.lock", "*pnpm-lock.yaml", "*package-lock.json", "*yarn.lock",
]

OPENROUTER_SYSTEM = (
    "You answer named questions about the state the user sends. Reply with one JSON object and nothing else: "
    '{"answers": {<question id>: <answer>}}. For a question of type "noul", the answer is '
    '{"type": "noul", "noul": <probability from 0 to 1 that the answer is yes>}. For a question of type "choice", '
    'the answer is {"type": "choice", "choice": <one option name from its criteria>, '
    '"probabilities": {<option>: <probability from 0 to 1>}, "confidence": <0 to 1>}.'
)


def _safe_url(value, default):
    """An override is used only when it is https or points at this machine (the self-test stub)."""
    from urllib.parse import urlparse

    if not value:
        return default
    parsed = urlparse(value)
    if parsed.scheme == "https" or parsed.hostname in ("127.0.0.1", "localhost"):
        return value
    return default


def _none(reason):
    return {"source": "none", "answers": {}, "reason": reason}


def _is_probability(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 1


def _validate(answers, questions):
    """Returns the answers when every question has a well-formed answer, else raises ValueError."""
    if not isinstance(answers, dict):
        raise ValueError("reply has no answers object")
    for qid, question in questions.items():
        answer = answers.get(qid)
        if not isinstance(answer, dict):
            raise ValueError(f"no answer for {qid}")
        if question["type"] == "noul":
            if not _is_probability(answer.get("noul")):
                raise ValueError(f"answer for {qid} is not a probability")
        else:
            options = question.get("criteria", {})
            probabilities = answer.get("probabilities", {})
            if not isinstance(probabilities, dict):
                raise ValueError(f"answer for {qid} has probabilities that are not an object")
            if answer.get("choice") not in options:
                raise ValueError(f"answer for {qid} picks an option outside its criteria")
            if not _is_probability(answer.get("confidence")) or not all(_is_probability(p) for p in probabilities.values()):
                raise ValueError(f"answer for {qid} has a value outside 0 to 1")
    return {qid: answers[qid] for qid in questions}


def _post(url, key, body, timeout):
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read())


def _json_from_text(text):
    """The first JSON object in a chat reply, allowing a code fence around it."""
    match = re.search(r"\{.*\}", text or "", re.S)
    if not match:
        raise ValueError("reply has no JSON object")
    return json.loads(match.group(0))


def ask(state, questions, *, timeout=20.0):
    """
    Ask each question over one state. Returns {"source", "answers", "reason"}.
    Never raises: every failure comes back as source "none" with the reason.
    """
    typesafe_key = os.environ.get("TYPESAFE_API_KEY")
    openrouter_key = os.environ.get("OPENROUTER_API_KEY")
    if not typesafe_key and not openrouter_key:
        return _none("no API key set (TYPESAFE_API_KEY or OPENROUTER_API_KEY)")
    if not isinstance(questions, dict) or not all(isinstance(q, dict) and q.get("type") in ("noul", "choice") for q in questions.values()):
        return _none("questions must be an object of {type: noul|choice, ...} entries")
    state = prepare_state(state)
    try:
        if typesafe_key:
            url = _safe_url(os.environ.get("JEV_TYPESAFE_URL"), TYPESAFE_URL)
            reply = _post(url, typesafe_key, {"model": "jev-latest", "state": state, "questions": questions}, timeout)
            return {"source": "typesafe", "answers": _validate(reply.get("answers"), questions), "reason": None}
        url = _safe_url(os.environ.get("JEV_OPENROUTER_URL"), OPENROUTER_URL)
        body = {
            "model": "typesafe/jev-router",
            "messages": [
                {"role": "system", "content": OPENROUTER_SYSTEM},
                {"role": "user", "content": json.dumps({"questions": questions, "state": state})},
            ],
        }
        reply = _post(url, openrouter_key, body, timeout)
        content = reply["choices"][0]["message"]["content"]
        answers = _json_from_text(content).get("answers")
        return {"source": "openrouter", "answers": _validate(answers, questions), "reason": None}
    except urllib.error.HTTPError as e:
        return _none(f"HTTP {e.code} from Jev")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return _none(f"could not reach Jev: {e}")
    except (ValueError, KeyError, IndexError, TypeError, AttributeError) as e:
        return _none(f"malformed reply: {e}")


def _is_sensitive(path):
    return any(fnmatch.fnmatch(path, pattern) for pattern in SENSITIVE_PATHS)


def prepare_state(text):
    """Drops diff sections for env files, secret directories and lockfiles, then caps at 8192 bytes."""
    kept = []
    skipping = False
    for line in (text or "").splitlines(keepends=True):
        header = re.match(r"diff --git a/(\S+) b/(\S+)", line)
        if header:
            skipping = _is_sensitive(header.group(1)) or _is_sensitive(header.group(2))
        if not skipping:
            kept.append(line)
    encoded = "".join(kept).encode("utf-8")[:STATE_LIMIT_BYTES]
    return encoded.decode("utf-8", errors="ignore")


def _cli(argv):
    import argparse

    parser = argparse.ArgumentParser(prog="jev_client.py")
    sub = parser.add_subparsers(dest="command", required=True)
    ask_parser = sub.add_parser("ask")
    ask_parser.add_argument("--state-file", required=True)
    ask_parser.add_argument("--questions-file", required=True)
    ask_parser.add_argument("--timeout", type=float, default=20.0)
    args = parser.parse_args(argv)
    try:
        with open(args.state_file, encoding="utf-8") as f:
            state = f.read()
        with open(args.questions_file, encoding="utf-8") as f:
            questions = json.load(f)
        result = ask(state, questions, timeout=args.timeout)
    except (OSError, ValueError) as e:
        result = _none(f"could not read input: {e}")
    print(json.dumps(result))
    return 0


# --------------------------------------------------------------------------
# Dry run / self-test
# --------------------------------------------------------------------------

def _dry_run():
    import http.server
    import threading
    import time

    class Stub:
        mode = "typesafe_ok"
        requests = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            Stub.requests.append({"path": self.path, "auth": self.headers.get("Authorization"), "body": body})
            mode = Stub.mode
            if mode == "sleep":
                time.sleep(2)
            if mode == "500":
                self.send_response(500)
                self.end_headers()
                return
            answers = {
                "ui": {"type": "noul", "noul": 1.7 if mode == "out_of_range" else 0.82},
                "branch": {
                    "type": "choice",
                    "choice": "rebrand" if mode == "bad_choice" else "polish-hard",
                    "probabilities": {"lean-in": 0.1, "polish-hard": 0.8, "new-direction": 0.1},
                    "confidence": 0.7,
                },
            }
            if self.path.endswith("/chat/completions"):
                content = "```json\n" + json.dumps({"answers": answers}) + "\n```"
                payload = {"choices": [{"message": {"content": content}}]}
            else:
                payload = {"model": "jev-latest", "answers": answers}
            raw = b"{not json" if mode == "malformed" else json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(raw)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"

    questions = {
        "ui": {"type": "noul", "instructions": "This change alters what a user sees."},
        "branch": {
            "type": "choice",
            "instructions": "Which branch fits?",
            "criteria": {"lean-in": "coherent", "polish-hard": "keep identity", "new-direction": "generic"},
        },
    }

    def with_env(typesafe=None, openrouter=None, mode="typesafe_ok", timeout=5.0):
        Stub.mode = mode
        Stub.requests = []
        saved = {k: os.environ.get(k) for k in ("TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "JEV_TYPESAFE_URL", "JEV_OPENROUTER_URL")}
        try:
            for k in ("TYPESAFE_API_KEY", "OPENROUTER_API_KEY"):
                os.environ.pop(k, None)
            if typesafe:
                os.environ["TYPESAFE_API_KEY"] = typesafe
            if openrouter:
                os.environ["OPENROUTER_API_KEY"] = openrouter
            os.environ["JEV_TYPESAFE_URL"] = base + "/v1/systemone"
            os.environ["JEV_OPENROUTER_URL"] = base + "/api/v1/chat/completions"
            return ask("a small diff", questions, timeout=timeout)
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    def case_typesafe_answer():
        r = with_env(typesafe="ts-key")
        req = Stub.requests[0]
        return (
            r["source"] == "typesafe"
            and r["answers"]["ui"]["noul"] == 0.82
            and r["answers"]["branch"]["choice"] == "polish-hard"
            and req["path"] == "/v1/systemone"
            and req["auth"] == "Bearer ts-key"
            and req["body"]["model"] == "jev-latest"
            and req["body"]["questions"] == questions
        )

    def case_openrouter_answer_when_only_that_key():
        r = with_env(openrouter="or-key")
        req = Stub.requests[0]
        return (
            r["source"] == "openrouter"
            and r["answers"]["ui"]["noul"] == 0.82
            and req["path"] == "/api/v1/chat/completions"
            and req["body"]["model"] == "typesafe/jev-router"
            and req["auth"] == "Bearer or-key"
        )

    def case_typesafe_preferred_when_both_keys():
        r = with_env(typesafe="ts-key", openrouter="or-key")
        return r["source"] == "typesafe" and Stub.requests[0]["path"] == "/v1/systemone"

    def case_no_key_makes_no_request():
        r = with_env()
        return r["source"] == "none" and r["answers"] == {} and "key" in r["reason"] and Stub.requests == []

    def case_timeout_returns_none():
        r = with_env(typesafe="ts-key", mode="sleep", timeout=0.5)
        return r["source"] == "none" and r["reason"]

    def case_http_500_returns_none():
        r = with_env(typesafe="ts-key", mode="500")
        return r["source"] == "none" and "500" in r["reason"]

    def case_malformed_reply_returns_none():
        a = with_env(typesafe="ts-key", mode="malformed")
        b = with_env(openrouter="or-key", mode="malformed")
        return a["source"] == "none" and b["source"] == "none"

    def case_probability_out_of_range_returns_none():
        r = with_env(typesafe="ts-key", mode="out_of_range")
        return r["source"] == "none" and "ui" in r["reason"]

    def case_choice_not_in_criteria_returns_none():
        r = with_env(typesafe="ts-key", mode="bad_choice")
        return r["source"] == "none" and "branch" in r["reason"]

    def case_lockfile_section_dropped():
        diff = (
            "diff --git a/app/page.tsx b/app/page.tsx\n+<h1>Hi</h1>\n"
            "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\n+lockfile: noise\n"
            "diff --git a/.env.local b/.env.local\n+SECRET=abc\n"
            "diff --git a/config/secrets/key.pem b/config/secrets/key.pem\n+-----BEGIN\n"
        )
        out = prepare_state(diff)
        return "<h1>Hi</h1>" in out and "lockfile" not in out and "SECRET" not in out and "BEGIN" not in out

    def case_more_secret_files_dropped():
        names = ["certs/server.pem", "id.key", ".npmrc", "config/gcp-credentials.json", ".dev.vars", "prod.tfvars", ".env.production"]
        diff = "".join(f"diff --git a/{n} b/{n}\n+SECRET-{i}\n" for i, n in enumerate(names)) + "diff --git a/app/a.tsx b/app/a.tsx\n+ok\n"
        out = prepare_state(diff)
        return "SECRET" not in out and "+ok" in out

    def case_bad_questions_return_none():
        saved = os.environ.get("TYPESAFE_API_KEY")
        os.environ["TYPESAFE_API_KEY"] = "k"
        try:
            a = ask("state", ["not", "a", "dict"])
            b = ask("state", {"q": "not a dict"})
        finally:
            if saved is None:
                os.environ.pop("TYPESAFE_API_KEY", None)
            else:
                os.environ["TYPESAFE_API_KEY"] = saved
        return a["source"] == "none" and b["source"] == "none"

    def case_non_dict_probabilities_return_none():
        try:
            _validate({"b": {"type": "choice", "choice": "x", "probabilities": [0.1, 0.9], "confidence": 0.5}},
                      {"b": {"type": "choice", "instructions": "?", "criteria": {"x": "y"}}})
        except ValueError:
            return True
        return False

    def case_remote_override_must_be_https():
        return _safe_url("http://evil.example/steal", "d") == "d" and _safe_url("http://127.0.0.1:9/x", "d") == "http://127.0.0.1:9/x" \
            and _safe_url("https://proxy.example/v1", "d") == "https://proxy.example/v1"

    def case_state_capped_at_8192_bytes():
        out = prepare_state("é" * 10000)
        return len(out.encode("utf-8")) <= 8192 and out.encode("utf-8").decode("utf-8") == out

    cases = [
        case_typesafe_answer,
        case_openrouter_answer_when_only_that_key,
        case_typesafe_preferred_when_both_keys,
        case_no_key_makes_no_request,
        case_timeout_returns_none,
        case_http_500_returns_none,
        case_malformed_reply_returns_none,
        case_probability_out_of_range_returns_none,
        case_choice_not_in_criteria_returns_none,
        case_lockfile_section_dropped,
        case_more_secret_files_dropped,
        case_state_capped_at_8192_bytes,
        case_bad_questions_return_none,
        case_non_dict_probabilities_return_none,
        case_remote_override_must_be_https,
    ]
    failed = 0
    for case in cases:
        try:
            ok = bool(case())
        except Exception as e:  # a crash is a failure, with its reason shown
            ok = False
            print(f"  {case.__name__}: {type(e).__name__}: {e}")
        print(f"{'PASS' if ok else 'FAIL'} {case.__name__[5:]}")
        failed += 0 if ok else 1
    server.shutdown()
    print(f"{len(cases) - failed}/{len(cases)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    if "--dry-run" in sys.argv:
        sys.exit(_dry_run())
    sys.exit(_cli(sys.argv[1:]))
