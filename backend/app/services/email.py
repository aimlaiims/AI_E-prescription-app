"""
Outgoing email over SMTP (standard library). Configured in backend/.env:
SMTP_HOST, SMTP_PORT (587 = STARTTLS, 465 = SSL), SMTP_USER, SMTP_PASSWORD,
SMTP_FROM. With a Gmail account use an "app password", not the login password.

Not configured -> nothing is sent and the message (including any link) is
written to the backend log instead, so password reset can still be tested
locally. Never leave it unconfigured on a shared machine.
"""
import logging
import smtplib
import ssl
from email.message import EmailMessage

from ..config import settings

logger = logging.getLogger(__name__)


def send_email(to: str, subject: str, body: str) -> bool:
    """True if handed to the SMTP server. Never raises: failures are logged."""
    if not settings.SMTP_HOST:
        logger.warning("SMTP is not configured; email NOT sent.\nTo: %s\nSubject: %s\n\n%s", to, subject, body)
        return False

    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM or settings.SMTP_USER
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    context = ssl.create_default_context()
    try:
        if settings.SMTP_PORT == 465:
            server = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20, context=context)
        else:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20)
        with server:
            if settings.SMTP_PORT != 465:
                server.starttls(context=context)
            if settings.SMTP_USER:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(msg)
        return True
    except (smtplib.SMTPException, OSError) as e:
        logger.error("Sending email to %s failed: %s", to, e)
        return False
