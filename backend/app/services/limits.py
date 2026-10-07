"""
Fair, bounded access to Groq and Gemini when many doctors dictate at once.

Without this, every request goes straight to the provider: past its per-minute
limit, EVERYONE gets refused together. Instead each provider gets:
  - at most N calls in progress (`*_MAX_IN_FLIGHT`); the rest wait in a
    first-come, first-served queue;
  - optionally at most M calls started per minute (`*_PER_MINUTE`), set a little
    below the provider plan's limit;
  - a cap on the wait (`VOICE_QUEUE_WAIT_SECONDS`): past it the request answers
    `busy` ("many people are dictating right now") — never a field update.
And each call, once started, has a deadline (`deadline`): a hung provider
answers `unavailable` instead of holding the request forever.

Everything here runs on the server's single event loop (one process), so
plain counters need no locks. The limiters are created by `reset()` — at import,
and again by the tests (asyncio objects belong to one event loop).
"""
import asyncio
import collections
import logging
from contextlib import asynccontextmanager, contextmanager

from ..config import settings
from ..errors import UpstreamError

logger = logging.getLogger(__name__)

BUSY_RETRY_SECONDS = 5.0


def _busy(what: str, retry_after: float = BUSY_RETRY_SECONDS) -> UpstreamError:
    return UpstreamError(f"{what}: too many requests waiting", code="busy", retry_after=round(retry_after, 1))


class ProviderLimiter:
    def __init__(self, name: str, max_in_flight: int, per_minute: int, max_wait: float, window: float = 60.0):
        self.name = name
        self.max_in_flight = max(1, max_in_flight)
        self.per_minute = max(0, per_minute)
        self.max_wait = max_wait
        self.window = window
        self._slots = asyncio.Semaphore(self.max_in_flight)  # wakes waiters in arrival order
        self._rate_turn = asyncio.Lock()  # FIFO too: one waiter at a time for the per-minute budget
        self._starts = collections.deque()
        self.in_flight = 0
        self.peak_in_flight = 0  # for tests and the load script

    @asynccontextmanager
    async def slot(self):
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.max_wait
        try:
            async with asyncio.timeout(self.max_wait):
                await self._slots.acquire()
        except TimeoutError:
            logger.warning("%s queue: waited %.0fs, answering busy", self.name, self.max_wait)
            raise _busy(self.name) from None
        try:
            await self._take_rate_budget(deadline)
            self.in_flight += 1
            self.peak_in_flight = max(self.peak_in_flight, self.in_flight)
            try:
                yield
            finally:
                self.in_flight -= 1
        finally:
            self._slots.release()

    async def _take_rate_budget(self, deadline: float):
        if not self.per_minute:
            return
        loop = asyncio.get_running_loop()
        try:
            async with asyncio.timeout_at(deadline):
                async with self._rate_turn:
                    while True:
                        now = loop.time()
                        while self._starts and now - self._starts[0] >= self.window:
                            self._starts.popleft()
                        if len(self._starts) < self.per_minute:
                            self._starts.append(now)
                            return
                        wait = self._starts[0] + self.window - now
                        if now + wait > deadline:
                            raise _busy(self.name, wait)
                        await asyncio.sleep(wait)
        except TimeoutError:
            raise _busy(self.name) from None


class PerUserLimit:
    """At most N voice requests in progress per signed-in user (protects the
    shared queue from one browser sending many at once)."""

    def __init__(self, max_per_user: int):
        self.max_per_user = max(1, max_per_user)
        self._active = collections.Counter()

    @contextmanager
    def hold(self, user_id: int):
        if self._active[user_id] >= self.max_per_user:
            raise _busy("per-user limit")
        self._active[user_id] += 1
        try:
            yield
        finally:
            self._active[user_id] -= 1
            if not self._active[user_id]:
                del self._active[user_id]


@asynccontextmanager
async def deadline(seconds: float, service: str):
    """A call that takes longer than `seconds` is cancelled and answers
    `unavailable` (the doctor sees "isn't responding, try again")."""
    try:
        async with asyncio.timeout(seconds):
            yield
    except TimeoutError:
        logger.warning("%s call exceeded %.0fs; cancelled", service, seconds)
        raise UpstreamError(f"{service} did not answer within {seconds:.0f}s", code="unavailable") from None


groq: ProviderLimiter
gemini: ProviderLimiter
local_whisper: ProviderLimiter
per_user: PerUserLimit


def reset():
    global groq, gemini, local_whisper, per_user
    groq = ProviderLimiter("groq", settings.GROQ_MAX_IN_FLIGHT, settings.GROQ_PER_MINUTE, settings.VOICE_QUEUE_WAIT_SECONDS)
    gemini = ProviderLimiter("gemini", settings.GEMINI_MAX_IN_FLIGHT, settings.GEMINI_PER_MINUTE, settings.VOICE_QUEUE_WAIT_SECONDS)
    # Local Whisper runs on this machine's CPU: one at a time.
    local_whisper = ProviderLimiter("local-whisper", 1, 0, settings.VOICE_QUEUE_WAIT_SECONDS)
    per_user = PerUserLimit(settings.VOICE_MAX_PER_USER)


reset()
