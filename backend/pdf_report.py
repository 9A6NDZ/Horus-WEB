"""
PDF Report Generator
====================
Generira PDF izvještaj o letu sa:
- sažetkom leta (max visina, trajanje, udaljenost)
- grafom visine kroz vrijeme
- grafom SNR-a
- kartom putanje (statična slika)
- tablicom ključnih paketa
"""

import io
from datetime import datetime
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # non-interactive backend
import matplotlib.pyplot as plt
from matplotlib.dates import DateFormatter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle, PageBreak
)


def _plot_to_image(fig) -> io.BytesIO:
    """Konvertira matplotlib figuru u BytesIO PNG."""
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120, bbox_inches="tight")
    buf.seek(0)
    plt.close(fig)
    return buf


def _make_altitude_chart(packets: list) -> io.BytesIO:
    times = [datetime.fromtimestamp(p["_rx_time"]) for p in packets]
    alts = [p["altitude"] for p in packets]

    fig, ax = plt.subplots(figsize=(9, 4))
    ax.plot(times, alts, linewidth=1.5, color="#2563eb")
    ax.fill_between(times, alts, alpha=0.15, color="#2563eb")
    ax.set_xlabel("Vrijeme (UTC)")
    ax.set_ylabel("Visina (m)")
    ax.set_title("Profil visine kroz vrijeme")
    ax.grid(True, alpha=0.3)
    ax.xaxis.set_major_formatter(DateFormatter("%H:%M:%S"))
    fig.autofmt_xdate()
    return _plot_to_image(fig)


def _make_snr_chart(packets: list) -> io.BytesIO:
    times = [datetime.fromtimestamp(p["_rx_time"]) for p in packets if p.get("snr") is not None]
    snrs = [p["snr"] for p in packets if p.get("snr") is not None]

    fig, ax = plt.subplots(figsize=(9, 3))
    ax.plot(times, snrs, linewidth=1.5, color="#16a34a")
    ax.axhline(y=0, color="red", linestyle="--", alpha=0.5, label="Demod prag")
    ax.set_xlabel("Vrijeme (UTC)")
    ax.set_ylabel("SNR (dB)")
    ax.set_title("Kvaliteta signala (SNR)")
    ax.grid(True, alpha=0.3)
    ax.legend()
    ax.xaxis.set_major_formatter(DateFormatter("%H:%M:%S"))
    fig.autofmt_xdate()
    return _plot_to_image(fig)


def _make_path_chart(packets: list) -> io.BytesIO:
    lats = [p["latitude"] for p in packets]
    lons = [p["longitude"] for p in packets]
    alts = [p["altitude"] for p in packets]

    fig, ax = plt.subplots(figsize=(7, 7))
    sc = ax.scatter(lons, lats, c=alts, cmap="viridis", s=8)
    ax.plot(lons, lats, linewidth=0.5, color="gray", alpha=0.5)
    ax.scatter([lons[0]], [lats[0]], color="green", s=100, marker="^", label="Launch", zorder=5)
    ax.scatter([lons[-1]], [lats[-1]], color="red", s=100, marker="v", label="Zadnji paket", zorder=5)
    plt.colorbar(sc, ax=ax, label="Visina (m)")
    ax.set_xlabel("Longituda")
    ax.set_ylabel("Latituda")
    ax.set_title("Putanja leta")
    ax.legend()
    ax.grid(True, alpha=0.3)
    ax.set_aspect("equal", adjustable="datalim")
    return _plot_to_image(fig)


def generate_flight_report(flight_data: dict, out_path: Path):
    """Generiraj PDF izvještaj o letu."""
    packets = flight_data.get("packets", [])
    if not packets:
        raise ValueError("No packets to report")

    doc = SimpleDocTemplate(
        str(out_path),
        pagesize=A4,
        rightMargin=1.5 * cm, leftMargin=1.5 * cm,
        topMargin=1.5 * cm, bottomMargin=1.5 * cm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "CustomTitle", parent=styles["Heading1"],
        fontSize=22, textColor=colors.HexColor("#1e3a8a"),
        spaceAfter=12, alignment=1,
    )
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], textColor=colors.HexColor("#1e40af"))
    normal = styles["Normal"]

    story = []

    # -- Header --
    story.append(Paragraph("Horus Flight Report", title_style))
    story.append(Paragraph(
        f"Callsign: <b>{flight_data.get('callsign', 'N/A')}</b> &nbsp;&nbsp; "
        f"Generirano: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}",
        normal,
    ))
    story.append(Spacer(1, 0.5 * cm))

    # -- Sažetak --
    story.append(Paragraph("Sažetak leta", h2))

    max_alt = flight_data.get("max_altitude", 0)
    total_dist = flight_data.get("total_distance_m", 0)
    phase = flight_data.get("phase", "N/A")
    burst = flight_data.get("burst_detected", False)
    pkt_count = len(packets)

    duration = 0
    if packets:
        duration = packets[-1]["_rx_time"] - packets[0]["_rx_time"]

    summary_data = [
        ["Parametar", "Vrijednost"],
        ["Broj paketa", f"{pkt_count}"],
        ["Trajanje", f"{duration/60:.1f} min"],
        ["Maksimalna visina", f"{max_alt:.0f} m"],
        ["Ukupna putanja", f"{total_dist/1000:.2f} km"],
        ["Burst detektiran", "DA" if burst else "NE"],
        ["Trenutna faza", phase.upper()],
    ]

    stats = flight_data.get("stats", {})
    if stats.get("snr_avg") is not None:
        summary_data.append(["SNR prosjek", f"{stats['snr_avg']:.1f} dB"])
        summary_data.append(["SNR min/max", f"{stats['snr_min']:.1f} / {stats['snr_max']:.1f} dB"])
    if stats.get("success_rate") is not None:
        summary_data.append(["Uspješnost dekodiranja", f"{stats['success_rate']:.1f} %"])

    tbl = Table(summary_data, colWidths=[6 * cm, 6 * cm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e40af")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f4f6")]),
        ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 0.5 * cm))

    # -- Grafovi --
    story.append(Paragraph("Profil visine", h2))
    story.append(Image(_make_altitude_chart(packets), width=17 * cm, height=7.5 * cm))
    story.append(Spacer(1, 0.3 * cm))

    story.append(Paragraph("Kvaliteta signala", h2))
    story.append(Image(_make_snr_chart(packets), width=17 * cm, height=5.5 * cm))

    story.append(PageBreak())

    story.append(Paragraph("Putanja leta", h2))
    story.append(Image(_make_path_chart(packets), width=15 * cm, height=15 * cm))

    # -- Ključni paketi --
    story.append(PageBreak())
    story.append(Paragraph("Ključni paketi", h2))

    key_data = [["Vrijeme", "Lat", "Lon", "Alt (m)", "SNR", "Faza"]]
    # Prvi, svaki stoti, i zadnji
    indices = set()
    indices.add(0)
    indices.add(len(packets) - 1)
    for i in range(0, len(packets), max(1, len(packets) // 20)):
        indices.add(i)

    for i in sorted(indices):
        p = packets[i]
        t = datetime.fromtimestamp(p["_rx_time"]).strftime("%H:%M:%S")
        key_data.append([
            t,
            f"{p['latitude']:.4f}",
            f"{p['longitude']:.4f}",
            f"{p['altitude']:.0f}",
            f"{p.get('snr', 0):.1f}",
            p.get("phase", "-"),
        ])

    tbl2 = Table(key_data, repeatRows=1)
    tbl2.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e40af")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    story.append(tbl2)

    # -- Footer --
    story.append(Spacer(1, 1 * cm))
    story.append(Paragraph(
        "<font size=8 color=gray>Generirano pomoću Horus Web • "
        "Podaci iz Horus Binary telemetrijskog dekodera</font>",
        normal,
    ))

    doc.build(story)
