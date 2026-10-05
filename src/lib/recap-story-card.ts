/**
 * Instagram-Story share card for the monthly League Recap (1080×1920).
 * Same visual language and safe zone as the workout story card.
 */
import { STORY_H, STORY_W, SAFE_BOTTOM, SAFE_TOP, ellipsize, fitFont, font, loadImage, roundRect } from "@/lib/workout-story-card";
import { compactWeight, monthName, type LeagueRecap } from "@/lib/league-recap";

const RED = "#ef3340";

export async function drawRecapStory(canvas: HTMLCanvasElement, r: LeagueRecap, athleteName?: string | null) {
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cx = STORY_W / 2;
  const me = r.me;
  const month = monthName(r.month_start);

  // Background
  ctx.fillStyle = "#07070a";
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  let g = ctx.createRadialGradient(cx, 160, 40, cx, 160, 1150);
  g.addColorStop(0, "rgba(239,51,64,0.55)");
  g.addColorStop(0.5, "rgba(76,29,149,0.2)");
  g.addColorStop(1, "rgba(7,7,10,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  g = ctx.createRadialGradient(cx, STORY_H + 100, 40, cx, STORY_H + 100, 950);
  g.addColorStop(0, "rgba(234,179,8,0.2)");
  g.addColorStop(1, "rgba(7,7,10,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  for (let x = -STORY_H; x < STORY_W; x += 46) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + STORY_H, STORY_H); ctx.stroke();
  }
  ctx.restore();
  ctx.textAlign = "center";

  // Brand
  let y = SAFE_TOP + 20;
  const logo = await loadImage("/logo.png");
  ctx.font = font(900, 34);
  const brand = "JF EFFECT";
  const bw = ctx.measureText(brand).width;
  let bx = cx - ((logo ? 74 : 0) + bw) / 2;
  if (logo) {
    ctx.save(); roundRect(ctx, bx, y - 42, 56, 56, 14); ctx.clip(); ctx.drawImage(logo, bx, y - 42, 56, 56); ctx.restore();
    bx += 74;
  }
  ctx.textAlign = "left"; ctx.fillStyle = "#fff"; ctx.fillText(brand, bx, y); ctx.textAlign = "center";

  // Title
  y += 86;
  ctx.fillStyle = RED;
  ctx.font = font(900, 30);
  ctx.fillText("P E R F O R M A N C E   L E A G U E", cx, y);
  y += 120;
  ctx.fillStyle = "#fff";
  fitFont(ctx, month, 900, 900, 140, 80);
  ctx.fillText(month, cx, y);
  y += 64;
  ctx.fillStyle = "#f87171";
  ctx.font = font(900, 56);
  ctx.fillText("RECAP", cx, y);
  if (athleteName) {
    y += 64;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    fitFont(ctx, athleteName.toUpperCase(), 900, 800, 40, 26);
    ctx.fillText(ellipsize(ctx, athleteName.toUpperCase(), 900), cx, y);
  }

  // Rank + points hero
  y += 70;
  const heroH = 300;
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  roundRect(ctx, 70, y, STORY_W - 140, heroH, 40); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 2; ctx.stroke();
  const half = (STORY_W - 140) / 2;
  const colY = y + 60;
  ctx.fillStyle = "#a1a1aa"; ctx.font = font(800, 26);
  ctx.fillText("FINISHED", 70 + half / 2, colY);
  ctx.fillText("POINTS", 70 + half * 1.5, colY);
  ctx.fillStyle = "#fff"; ctx.font = font(900, 150);
  ctx.fillText(me.rank ? `#${me.rank}` : "—", 70 + half / 2, colY + 150);
  const pts = String(me.total_points);
  fitFont(ctx, pts, half - 60, 900, 150, 80);
  ctx.fillStyle = "#fbbf24";
  ctx.fillText(pts, 70 + half * 1.5, colY + 150);
  ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = font(700, 26);
  const athletes = r.league?.athletes ?? 0;
  if (athletes) ctx.fillText(`of ${athletes} athletes`, 70 + half / 2, colY + 200);
  if (me.beat_pct != null) ctx.fillText(`beat ${me.beat_pct}% of the league`, 70 + half * 1.5, colY + 200);
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.beginPath(); ctx.moveTo(cx, y + 40); ctx.lineTo(cx, y + heroH - 40); ctx.stroke();
  y += heroH + 36;

  // Stat tiles
  const recordsEra = r.month_start >= "2026-10-01";
  const records = me.atpr_lifts + me.program_pr_lifts + me.block_pr_lifts;
  const t = r.training;
  const stats = [
    { label: "WORKOUTS", value: String(me.workouts_completed) },
    t && t.tonnage_kg > 0
      ? { label: "LIFTED", value: compactWeight(t.tonnage_kg, t.unit === "kg" ? "kg" : "lb") }
      : { label: "FULLY LOGGED", value: String(me.fully_logged) },
    recordsEra
      ? { label: me.atpr_lifts ? "ATPRs" : "PRs", value: String(me.atpr_lifts || records) }
      : { label: "WEIGH-INS", value: String(me.bodyweight_logs) },
  ];
  const gap = 20;
  const tileW = (STORY_W - 140 - gap * 2) / 3;
  stats.forEach((s, i) => {
    const x = 70 + i * (tileW + gap);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    roundRect(ctx, x, y, tileW, 150, 30); ctx.fill();
    ctx.fillStyle = "#fff"; fitFont(ctx, s.value, tileW - 30, 900, 64, 30);
    ctx.fillText(s.value, x + tileW / 2, y + 82);
    ctx.fillStyle = "#a1a1aa"; ctx.font = font(800, 22);
    ctx.fillText(s.label, x + tileW / 2, y + 120);
  });
  y += 150 + 36;

  // Rivals W/L or podium line
  const wins = r.rivals.filter((rv) => rv.gap < 0).length;
  const losses = r.rivals.filter((rv) => rv.gap > 0).length;
  const lines: string[] = [];
  if (r.rivals.length) lines.push(`vs top rivals: ${wins}W – ${losses}L`);
  if (me.adherence_pct) lines.push(`${Math.round(me.adherence_pct)}% of workouts completed`);
  for (const l of lines.slice(0, 2)) {
    if (y + 80 > SAFE_BOTTOM - 70) break;
    ctx.font = font(900, 34);
    const w = ctx.measureText(l).width + 70;
    ctx.fillStyle = "rgba(251,191,36,0.12)";
    roundRect(ctx, cx - w / 2, y, w, 66, 33); ctx.fill();
    ctx.strokeStyle = "rgba(251,191,36,0.45)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#fbbf24"; ctx.textBaseline = "middle";
    ctx.fillText(l, cx, y + 34); ctx.textBaseline = "alphabetic";
    y += 86;
  }

  // Podium
  const podium = r.podium.slice(0, 3);
  if (podium.length && y + 54 + podium.length * 56 < SAFE_BOTTOM - 40) {
    y += 34;
    ctx.fillStyle = "#a1a1aa"; ctx.font = font(800, 24);
    ctx.fillText(`${month.toUpperCase()} PODIUM`, cx, y);
    y += 20;
    const medal = ["#facc15", "#cbd5e1", "#d97706"];
    podium.forEach((p, i) => {
      const rowY = y + i * 56;
      ctx.fillStyle = p.is_me ? "rgba(239,51,64,0.18)" : "rgba(255,255,255,0.05)";
      roundRect(ctx, 170, rowY, STORY_W - 340, 48, 24); ctx.fill();
      ctx.fillStyle = medal[i]; ctx.beginPath(); ctx.arc(206, rowY + 24, 15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#111"; ctx.font = font(900, 20); ctx.textBaseline = "middle";
      ctx.fillText(String(p.rank ?? i + 1), 206, rowY + 25);
      ctx.textAlign = "left"; ctx.fillStyle = "#fff"; ctx.font = font(800, 28);
      ctx.fillText(ellipsize(ctx, p.display_name + (p.is_me ? " (me)" : ""), 480), 240, rowY + 25);
      ctx.textAlign = "right"; ctx.fillStyle = "#fbbf24"; ctx.font = font(900, 28);
      ctx.fillText(`${p.total_points} pts`, STORY_W - 196, rowY + 25);
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    });
  }

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = font(800, 24);
  ctx.fillText("T R A I N E D   W I T H   J F   E F F E C T", cx, SAFE_BOTTOM - 8);
}

export async function recapStoryBlob(r: LeagueRecap, athleteName?: string | null): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  await drawRecapStory(canvas, r, athleteName);
  return new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
}

/** Share sheet when available (iOS "Save Image" lives there); otherwise download. */
export async function shareOrSaveImage(blob: Blob, fileName: string, title: string, mode: "share" | "save") {
  const file = new File([blob], fileName, { type: "image/png" });
  const canShare = !!navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }));
  if (canShare && (mode === "share" || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent))) {
    try {
      await navigator.share({ files: [file], title });
      return "shared" as const;
    } catch (e: any) {
      if (e?.name === "AbortError") return "cancelled" as const;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded" as const;
}
