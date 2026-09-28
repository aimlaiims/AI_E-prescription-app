"""
A single, explicit taxonomy for anything that goes wrong talking to Groq or
Gemini, so a failure always arrives at the frontend as one of a few known
`code`s the UI can react to correctly — instead of an unclassified exception
whose message might (as happened before) end up displayed or even written
somewhere as if it were real data.

Codes:
  "rate_limited" — 429. The caller should back off; carries `retry_after`
                   (seconds) when the upstream API told us how long, so the
                   frontend can show a countdown instead of a guess.
  "unavailable"  — 5xx / transient outage. Already retried a couple of times
                   server-side before this is raised, so if it's reaching the
                   frontend at all, it's worth surfacing plainly.
  "auth"         — bad/missing API key. This is a configuration problem, not
                   something retrying will fix.
  "unknown"      — anything else (network error, unexpected response shape).
"""


class UpstreamError(Exception):
    def __init__(self, message: str, code: str, retry_after: float | None = None):
        super().__init__(message)
        self.code = code
        self.retry_after = retry_after

    def http_status(self) -> int:
        return {
            "rate_limited": 429,
            "unavailable": 503,
            # 502 (not 401/403) because from the caller's (frontend's) point of
            # view, *our* server misconfigured its upstream credentials — this
            # isn't the frontend's own auth failing.
            "auth": 502,
            "unknown": 502,
        }.get(self.code, 500)