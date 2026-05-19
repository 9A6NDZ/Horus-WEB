"""
Email Notifier — Nova sonda u zraku
====================================
Šalje email notifikaciju kada se pojavi nova sonda (prvi primljeni paket).
Razmak između notifikacija za istu sondu je konfigurabilan (default 6 sati).
"""

import json
import logging
import smtplib
import ssl
import threading
import time
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

log = logging.getLogger("horus-web.email")


class EmailNotifier:
    """Prati nove sonde i šalje email notifikacije."""

    def __init__(self, config_path: Optional[str] = None):
        self.config_path = Path(config_path) if config_path else Path(__file__).parent / "email_config.json"
        self.config: dict = {}
        # callsign -> timestamp zadnje poslane notifikacije
        self._last_notified: dict[str, float] = {}
        self._lock = threading.Lock()
        self.load_config()

    def load_config(self):
        """Učitaj konfiguraciju iz JSON datoteke."""
        try:
            if self.config_path.exists():
                self.config = json.loads(self.config_path.read_text())
                log.info(f"Email config loaded: enabled={self.config.get('enabled', False)}, "
                         f"to={self.config.get('to_email', '(nije postavljeno)')}")
            else:
                self.config = self._default_config()
        except Exception as e:
            log.warning(f"Could not load email config: {e}")
            self.config = self._default_config()

    def save_config(self, new_config: dict):
        """Spremi konfiguraciju u JSON datoteku."""
        try:
            # Zadrži postojeći SMTP password ako novi nije poslan
            if not new_config.get("smtp_password") and self.config.get("smtp_password"):
                new_config["smtp_password"] = self.config["smtp_password"]

            self.config = new_config
            self.config_path.write_text(json.dumps(new_config, indent=2))
            log.info(f"Email config saved: enabled={new_config.get('enabled', False)}")
        except Exception as e:
            log.error(f"Could not save email config: {e}")
            raise

    def get_config_safe(self) -> dict:
        """Vrati konfiguraciju bez lozinke (za frontend)."""
        cfg = dict(self.config)
        pwd = cfg.get("smtp_password", "")
        cfg["smtp_password_set"] = bool(pwd)
        if pwd:
            cfg["smtp_password_preview"] = f"{'*' * min(len(pwd), 8)}"
        else:
            cfg["smtp_password_preview"] = ""
        cfg.pop("smtp_password", None)
        return cfg

    @staticmethod
    def _default_config() -> dict:
        return {
            "enabled": False,
            "smtp_server": "smtp.gmail.com",
            "smtp_port": 587,
            "smtp_user": "",
            "smtp_password": "",
            "from_email": "",
            "to_email": "",
            "cooldown_hours": 6,
        }

    @property
    def enabled(self) -> bool:
        return bool(self.config.get("enabled", False))

    @property
    def cooldown_seconds(self) -> float:
        return float(self.config.get("cooldown_hours", 6)) * 3600

    def should_notify(self, callsign: str) -> bool:
        """Provjeri treba li poslati notifikaciju za ovaj callsign."""
        if not self.enabled:
            return False

        # Provjeri da su SMTP postavke kompletne
        required = ["smtp_server", "smtp_port", "smtp_user", "smtp_password", "to_email"]
        for field in required:
            if not self.config.get(field):
                return False

        now = time.time()
        with self._lock:
            last = self._last_notified.get(callsign, 0)
            if now - last < self.cooldown_seconds:
                return False
            return True

    def mark_notified(self, callsign: str):
        """Označi da je notifikacija poslana za callsign."""
        with self._lock:
            self._last_notified[callsign] = time.time()

    def notify_new_sonde(self, callsign: str, packet: dict):
        """
        Ako je to nova sonda (ili je prošao cooldown), pošalji email.
        Poziva se iz on_packet — šalje u background threadu da ne blokira.
        """
        if not self.should_notify(callsign):
            return

        # Označi odmah (ne čekaj slanje) da se izbjegne duplo slanje
        self.mark_notified(callsign)

        # Pošalji u background threadu
        t = threading.Thread(
            target=self._send_notification,
            args=(callsign, dict(packet)),
            daemon=True,
        )
        t.start()

    def _send_notification(self, callsign: str, packet: dict):
        """Šalje email notifikaciju (blocking — poziva se iz threada)."""
        try:
            cfg = self.config
            smtp_server = cfg["smtp_server"]
            smtp_port = int(cfg["smtp_port"])
            smtp_user = cfg["smtp_user"]
            smtp_password = cfg["smtp_password"]
            from_email = cfg.get("from_email") or smtp_user
            to_email = cfg["to_email"]

            # Pripremi podatke za email
            lat = packet.get("latitude", 0)
            lon = packet.get("longitude", 0)
            alt = packet.get("altitude", 0)
            freq = packet.get("f_centre")
            snr = packet.get("snr")
            batt = packet.get("battery_voltage")
            temp = packet.get("temperature")
            phase = packet.get("phase", "unknown")
            timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

            subject = f"🎈 Nova sonda detektirana: {callsign}"

            # HTML tijelo emaila
            html_body = f"""
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px;">
  <div style="max-width: 500px; margin: 0 auto; background: #1e293b; border-radius: 12px; border: 1px solid #334155; overflow: hidden;">
    <div style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); padding: 16px 20px;">
      <h2 style="margin: 0; color: white; font-size: 18px;">🎈 Nova sonda u zraku!</h2>
    </div>
    <div style="padding: 20px;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #94a3b8; font-size: 13px;">Callsign</td>
          <td style="padding: 8px 0; color: #f1f5f9; font-weight: 600; font-size: 15px;">{callsign}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #94a3b8; font-size: 13px;">Vrijeme</td>
          <td style="padding: 8px 0; color: #f1f5f9;">{timestamp}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #94a3b8; font-size: 13px;">Pozicija</td>
          <td style="padding: 8px 0; color: #f1f5f9;">{lat:.5f}, {lon:.5f}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #94a3b8; font-size: 13px;">Visina</td>
          <td style="padding: 8px 0; color: #f1f5f9;">{alt:.0f} m</td>
        </tr>"""

            if snr is not None:
                html_body += f"""
        <tr>
          <td style="padding: 8px 0; color: #94a3b8; font-size: 13px;">SNR</td>
          <td style="padding: 8px 0; color: #f1f5f9;">{snr:.1f} dB</td>
        </tr>"""

            if freq is not None:
                html_body += f"""
        <tr>
          <td style="padding: 8px 0; color: #94a3b8; font-size: 13px;">Frekvencija</td>
          <td style="padding: 8px 0; color: #f1f5f9;">{freq:.0f} Hz</td>
        </tr>"""

            if batt is not None:
                html_body += f"""
        <tr>
          <td style="padding: 8px 0; color: #94a3b8; font-size: 13px;">Baterija</td>
          <td style="padding: 8px 0; color: #f1f5f9;">{batt:.2f} V</td>
        </tr>"""

            if temp is not None:
                html_body += f"""
        <tr>
          <td style="padding: 8px 0; color: #94a3b8; font-size: 13px;">Temperatura</td>
          <td style="padding: 8px 0; color: #f1f5f9;">{temp:.1f} °C</td>
        </tr>"""

            html_body += f"""
        <tr>
          <td style="padding: 8px 0; color: #94a3b8; font-size: 13px;">Faza</td>
          <td style="padding: 8px 0; color: #f1f5f9;">{phase}</td>
        </tr>
      </table>"""

            if abs(lat) > 0.001 and abs(lon) > 0.001:
                maps_url = f"https://www.google.com/maps?q={lat},{lon}"
                sondehub_url = f"https://amateur.sondehub.org/#!mt=Mapnik&mz=9&qm=12h&mc={lat},{lon}&f={callsign}"
                html_body += f"""
      <div style="margin-top: 16px; display: flex; gap: 10px; flex-wrap: wrap;">
        <a href="{sondehub_url}" style="display: inline-block; background: #10b981; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">📡 SondeHub Amateur</a>
        <a href="{maps_url}" style="display: inline-block; background: #3b82f6; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">📍 Google Maps</a>
      </div>"""

            html_body += """
      <p style="margin-top: 16px; color: #64748b; font-size: 11px;">
        Poslano automatski iz Horus Web sustava.
      </p>
    </div>
  </div>
</body>
</html>"""

            # Plaintext verzija
            text_body = f"""Nova sonda detektirana: {callsign}
Vrijeme: {timestamp}
Pozicija: {lat:.5f}, {lon:.5f}
Visina: {alt:.0f} m
Faza: {phase}"""
            if snr is not None:
                text_body += f"\nSNR: {snr:.1f} dB"
            if batt is not None:
                text_body += f"\nBaterija: {batt:.2f} V"
            if temp is not None:
                text_body += f"\nTemperatura: {temp:.1f} °C"
            if abs(lat) > 0.001 and abs(lon) > 0.001:
                text_body += f"\n\nSondeHub Amateur: https://amateur.sondehub.org/#!mt=Mapnik&mz=9&qm=12h&mc={lat},{lon}&f={callsign}"
                text_body += f"\nGoogle Maps: https://www.google.com/maps?q={lat},{lon}"

            # Sastavi MIME poruku
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = from_email
            msg["To"] = to_email
            msg.attach(MIMEText(text_body, "plain", "utf-8"))
            msg.attach(MIMEText(html_body, "html", "utf-8"))

            # Pošalji
            if smtp_port == 465:
                # SSL
                context = ssl.create_default_context()
                with smtplib.SMTP_SSL(smtp_server, smtp_port, context=context, timeout=15) as server:
                    server.login(smtp_user, smtp_password)
                    server.send_message(msg)
            else:
                # STARTTLS (port 587 ili drugi)
                context = ssl.create_default_context()
                with smtplib.SMTP(smtp_server, smtp_port, timeout=15) as server:
                    server.starttls(context=context)
                    server.login(smtp_user, smtp_password)
                    server.send_message(msg)

            log.info(f"✉ Email notifikacija poslana za {callsign} na {to_email}")

        except Exception as e:
            log.error(f"✉ Greška slanja emaila za {callsign}: {e}")
            # Ponisti mark_notified da se može pokušati ponovo na sljedećem paketu
            with self._lock:
                self._last_notified.pop(callsign, None)

    def send_test_email(self) -> dict:
        """Pošalji testni email — sinhrono, vraća rezultat."""
        cfg = self.config
        required = ["smtp_server", "smtp_port", "smtp_user", "smtp_password", "to_email"]
        for field in required:
            if not cfg.get(field):
                return {"ok": False, "error": f"Nedostaje polje: {field}"}

        try:
            smtp_server = cfg["smtp_server"]
            smtp_port = int(cfg["smtp_port"])
            smtp_user = cfg["smtp_user"]
            smtp_password = cfg["smtp_password"]
            from_email = cfg.get("from_email") or smtp_user
            to_email = cfg["to_email"]

            timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

            msg = MIMEMultipart("alternative")
            msg["Subject"] = "✅ Horus Web — Test email notifikacije"
            msg["From"] = from_email
            msg["To"] = to_email

            text = f"Test email notifikacije iz Horus Web sustava.\nVrijeme: {timestamp}\n\nAko vidite ovaj email, konfiguracija je ispravna!"
            html = f"""
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px;">
  <div style="max-width: 500px; margin: 0 auto; background: #1e293b; border-radius: 12px; border: 1px solid #334155; overflow: hidden;">
    <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 16px 20px;">
      <h2 style="margin: 0; color: white; font-size: 18px;">✅ Test uspješan!</h2>
    </div>
    <div style="padding: 20px;">
      <p style="color: #e2e8f0; font-size: 14px; margin: 0 0 8px;">
        Email notifikacije iz <strong>Horus Web</strong> sustava su ispravno konfigurirane.
      </p>
      <p style="color: #94a3b8; font-size: 12px; margin: 0;">
        Vrijeme: {timestamp}
      </p>
      <p style="color: #94a3b8; font-size: 12px; margin: 8px 0 0;">
        Kada se detektira nova sonda u zraku, dobit ćete notifikaciju na ovaj email.
      </p>
    </div>
  </div>
</body>
</html>"""

            msg.attach(MIMEText(text, "plain", "utf-8"))
            msg.attach(MIMEText(html, "html", "utf-8"))

            if smtp_port == 465:
                context = ssl.create_default_context()
                with smtplib.SMTP_SSL(smtp_server, smtp_port, context=context, timeout=15) as server:
                    server.login(smtp_user, smtp_password)
                    server.send_message(msg)
            else:
                context = ssl.create_default_context()
                with smtplib.SMTP(smtp_server, smtp_port, timeout=15) as server:
                    server.starttls(context=context)
                    server.login(smtp_user, smtp_password)
                    server.send_message(msg)

            log.info(f"✉ Test email poslan na {to_email}")
            return {"ok": True, "message": f"Test email poslan na {to_email}"}

        except smtplib.SMTPAuthenticationError:
            return {"ok": False, "error": "Autentifikacija neuspješna — provjeri korisničko ime i lozinku (za Gmail koristi App Password)"}
        except smtplib.SMTPConnectError:
            return {"ok": False, "error": f"Ne mogu se spojiti na {cfg.get('smtp_server')}:{cfg.get('smtp_port')}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}
