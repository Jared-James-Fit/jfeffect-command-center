import { describe, expect, it } from "vitest";
import { zlibSync } from "fflate";
import {
  CREW_PHOTO_COPY,
  DAY_MS,
  HEADSHOT_COPY,
  clientCopyFor,
  crewPointDays,
  crewReminderDue,
  headshotOutstanding,
  headshotPointDays,
  headshotPointsDue,
  headshotStatus,
  nextHeadshotPoint,
  pickChallenge,
  sanitizePhotoReminders,
  shouldSendHeadshotReminder,
  snoozeUntil,
  storedPhotoReminders,
  headshotScheduleWords,
  DEFAULT_PHOTO_REMINDERS,
} from "@/lib/headshots/rules";
import { decodePng, jpegInfo } from "@/lib/headshots/png";
import { TILE, bandDiff, dHash, deviceCheckProblems, hamming, readEvidence, type DeviceChecks } from "@/lib/headshots/evidence";

/* ---- a tiny PNG writer for the tests (all five filters, RGB or RGBA) ---- */
function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function encodePng(width: number, height: number, rgba: Uint8Array, channels: 3 | 4, filterOf: (y: number) => number = () => 0): Uint8Array {
  const stride = width * channels;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const f = filterOf(y);
    raw[y * (stride + 1)] = f;
    for (let x = 0; x < stride; x++) {
      const v = rgba[y * stride + x]!;
      const a = x >= channels ? rgba[y * stride + x - channels]! : 0;
      const b = y > 0 ? rgba[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? rgba[(y - 1) * stride + x - channels]! : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pr;
      raw[y * (stride + 1) + 1 + x] = (v - pred) & 255;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw)), chunk("IEND", new Uint8Array())];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** A face-ish tile: a lit oval with darker eye and mouth bands, seeded noise for texture. */
function faceTile(opts: { eyesClosed?: boolean; shift?: number; seed?: number; light?: number; bg?: number; turn?: number } = {}): Uint8Array {
  const t = new Uint8Array(TILE * TILE);
  let s = opts.seed ?? 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const light = opts.light ?? 150;
  const shift = opts.shift ?? 0;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const dx = (x - 80 - shift) / 50;
      const dy = (y - 85) / 66;
      let v = dx * dx + dy * dy < 1 ? light : opts.bg ?? 60;
      const yy = y / TILE;
      if (dx * dx + dy * dy < 1) {
        // a head turn moves the eyes, nose and mouth across the face, not the face's outline
        const f = shift + (opts.turn ?? 0);
        const eyeL = Math.hypot(x - (60 + f), y - 70) < 9;
        const eyeR = Math.hypot(x - (100 + f), y - 70) < 9;
        if (eyeL || eyeR) v = opts.eyesClosed ? light - 25 : 40;
        if (Math.abs(x - 80 - f) < 4 && y > 78 && y < 100) v = light - 30;
        if (yy > 0.68 && yy < 0.72 && Math.abs(x - 80 - f) < 20) v = 90;
      }
      t[y * TILE + x] = Math.max(0, Math.min(255, Math.round(v + (rnd() - 0.5) * 6)));
    }
  }
  return t;
}
function strip(tiles: Uint8Array[]): Uint8Array {
  const w = TILE * tiles.length;
  const rgb = new Uint8Array(w * TILE * 3);
  tiles.forEach((t, i) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const v = t[y * TILE + x]!;
      const o = (y * w + i * TILE + x) * 3;
      rgb[o] = v;
      rgb[o + 1] = v;
      rgb[o + 2] = v;
    }
  });
  return encodePng(w, TILE, rgb, 3, (y) => y % 5);
}

describe("PNG reader", () => {
  it("decodes RGB and RGBA with every filter", () => {
    const w = 13;
    const h = 9;
    for (const ch of [3, 4] as const) {
      const px = new Uint8Array(w * h * ch).map((_, i) => (i * 37 + (i >> 3)) & 255);
      const img = decodePng(encodePng(w, h, px, ch, (y) => y % 5));
      expect(img.width).toBe(w);
      expect(img.height).toBe(h);
      expect(img.channels).toBe(ch);
      expect(Array.from(img.data)).toEqual(Array.from(px));
    }
  });
  it("refuses what isn't a PNG", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow("not_png");
  });
  it("reads a JPEG's size and EXIF without decoding it", () => {
    const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x02, 0xd0, 0x03];
    const jfif = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
    const plain = new Uint8Array([0xff, 0xd8, ...jfif, ...sof, ...new Array(20).fill(0)]);
    expect(jpegInfo(plain)).toEqual({ width: 720, height: 720, exif: false });
    const exifSeg = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0, 0];
    const withExif = new Uint8Array([0xff, 0xd8, ...exifSeg, ...sof, ...new Array(20).fill(0)]);
    expect(jpegInfo(withExif)?.exif).toBe(true);
    expect(jpegInfo(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe("evidence frames", () => {
  it("confirms a blink (the eyes change, the rest doesn't) and a turn", () => {
    const base = faceTile();
    const img = decodePng(strip([base, faceTile({ eyesClosed: true, seed: 9 }), faceTile({ turn: 12, seed: 11 })]));
    const v = readEvidence(img, ["blink", "turn_left"], [{ eyeTop: 0.36, eyeBottom: 0.52 }]);
    expect(v.ok).toBe(true);
    expect(v.blink?.confirmed).toBe(true);
    expect(v.turn?.confirmed).toBe(true);
    expect(v.flags).not.toContain("blink_unconfirmed");
    expect(v.dhash).toMatch(/^[0-9a-f]{16}$/);
  });
  it("refuses a still picture sent as every frame (a print, a screenshot, frames replayed)", () => {
    const base = faceTile();
    const img = decodePng(strip([base, base, base]));
    const v = readEvidence(img, ["turn_right", "blink"]);
    expect(v.ok).toBe(false);
    expect(v.fail).toBe("still_image");
  });
  it("flags a 'blink' and a 'turn' where the whole picture only slid sideways", () => {
    const img = decodePng(strip([faceTile(), faceTile({ shift: 12, seed: 5 }), faceTile({ shift: -12, seed: 3 })]));
    const v = readEvidence(img, ["blink", "turn_right"]);
    expect(v.ok).toBe(true);
    expect(v.flags).toContain("blink_unconfirmed");
    expect(v.flags).toContain("turn_unconfirmed");
  });
  it("refuses a frame too dark to see, and flags a dim one", () => {
    expect(readEvidence(decodePng(strip([faceTile({ light: 20 }).map((v) => Math.min(v, 30)), faceTile({ light: 25 }), faceTile({ light: 24 })])), ["blink", "turn_left"]).fail).toBe("too_dark");
    const dim = readEvidence(decodePng(strip([faceTile({ light: 58, bg: 15 }), faceTile({ light: 58, bg: 15, eyesClosed: true, seed: 2 }), faceTile({ light: 58, bg: 15, turn: 12, seed: 4 })])), ["blink", "turn_left"]);
    expect(dim.ok).toBe(true);
    expect(dim.flags).toContain("low_light");
  });
  it("refuses a strip of the wrong shape", () => {
    expect(readEvidence(decodePng(strip([faceTile()])), ["blink", "turn_left"]).fail).toBe("unreadable");
  });
  it("fingerprints a face the same way twice, and a different one differently", () => {
    const a = dHash(faceTile());
    // the same photo saved again a touch brighter reads as the same picture
    expect(hamming(a, dHash(faceTile({ light: 153 })))).toBeLessThanOrEqual(6);
    expect(hamming(a, dHash(faceTile({ shift: 30 })))).toBeGreaterThan(6);
    expect(hamming(a, null)).toBe(64);
  });
  it("measures a difference only inside the band asked for", () => {
    const a = new Uint8Array(TILE * TILE).fill(100);
    const b = a.slice();
    for (let y = 60; y < 80; y++) for (let x = 0; x < TILE; x++) b[y * TILE + x] = 160;
    expect(bandDiff(a, b, 60 / TILE, 80 / TILE)).toBeCloseTo(60, 0);
    expect(bandDiff(a, b, 0.6, 0.8)).toBe(0);
  });
});

describe("device checks", () => {
  const good: DeviceChecks = {
    model: "face_landmarker",
    steps: [{ step: "blink", ms: 900, peak: 0.7 }, { step: "turn_left", ms: 1400, peak: 18 }],
    final: { faces: 1, faceShare: 0.4, yaw: 2, pitch: -3, roll: 1, brightness: 130, sharpness: 120 },
    tiles: [],
    durationMs: 5200,
  };
  it("passes a capture that followed its challenge", () => {
    expect(deviceCheckProblems(good, ["blink", "turn_left"], "guided")).toEqual([]);
  });
  it("names what doesn't add up", () => {
    expect(deviceCheckProblems(good, ["turn_left", "blink"], "guided")).toContain("steps_out_of_order");
    expect(deviceCheckProblems({ ...good, steps: [good.steps[0]!, { step: "turn_left", ms: 900, peak: -20 }] }, ["blink", "turn_left"], "guided")).toContain("turn_left_weak");
    expect(deviceCheckProblems({ ...good, final: { ...good.final!, faces: 2 } }, ["blink", "turn_left"], "guided")).toContain("faces");
    expect(deviceCheckProblems({ ...good, durationMs: 200 }, ["blink", "turn_left"], "guided")).toContain("duration");
  });
  it("asks nothing of a plain live or coach-assisted photo", () => {
    expect(deviceCheckProblems({ ...good, model: null, steps: [], final: null }, [], "live")).toEqual([]);
  });
});

describe("statuses", () => {
  const base = { displayPath: null, acceptedDisplayPath: null, pending: false, openRequest: null };
  it("reads one word for where a headshot stands", () => {
    expect(headshotStatus(base)).toBe("missing");
    expect(headshotStatus({ ...base, displayPath: "u/avatar-1.jpg" })).toBe("previous");
    expect(headshotStatus({ ...base, displayPath: "u/headshot-2.jpg", acceptedDisplayPath: "u/headshot-2.jpg" })).toBe("verified");
    expect(headshotStatus({ ...base, displayPath: "u/avatar-1.jpg", openRequest: { kind: "manual" } })).toBe("retake_requested");
    expect(headshotStatus({ ...base, displayPath: "u/avatar-1.jpg", openRequest: { kind: "manual" }, pending: true })).toBe("pending");
    // a new client who hasn't added one yet: missing (onboarding isn't a retake)
    expect(headshotStatus({ ...base, openRequest: { kind: "onboarding" } })).toBe("missing");
  });
  it("keeps a previously submitted photo until a replacement is accepted", () => {
    expect(headshotStatus({ ...base, displayPath: "u/avatar-1.jpg", acceptedDisplayPath: null, openRequest: { kind: "review" } })).toBe("retake_requested");
  });
  it("has the client act only on an open request with nothing waiting", () => {
    expect(headshotOutstanding({ pending: false, openRequest: { kind: "manual" } })).toBe(true);
    expect(headshotOutstanding({ pending: true, openRequest: { kind: "manual" } })).toBe(false);
    expect(headshotOutstanding({ pending: false, openRequest: null })).toBe(false);
  });
});

describe("the client's words", () => {
  it("is the same standard request whoever asked, and never a name or a reason", () => {
    expect(clientCopyFor("manual")).toEqual(clientCopyFor("review"));
    expect(clientCopyFor("manual").title).toBe("Account headshot update required");
    expect(clientCopyFor("manual").body).toBe(
      "Please update your account headshot to ensure your profile meets our account photo standards. This only takes a moment and can be completed whenever you're ready.",
    );
    expect(HEADSHOT_COPY.later).toBe("Remind me later");
    expect(JSON.stringify(HEADSHOT_COPY)).not.toMatch(/coach jared|automatic|detected/i);
    expect(CREW_PHOTO_COPY.title).toBe("Make your Crew profile yours!");
    expect(CREW_PHOTO_COPY.body).toBe("Upload any picture you want. It doesn't have to be you.");
  });
});

describe("headshot reminder schedule", () => {
  const s = DEFAULT_PHOTO_REMINDERS.headshot;
  const t0 = new Date("2026-12-01T15:00:00Z");
  const at = (days: number) => new Date(t0.getTime() + days * DAY_MS);
  it("is the request, then 3, 7 and 14 days, then every 14", () => {
    expect(headshotPointDays(s, 60)).toEqual([0, 3, 7, 14, 28, 42, 56]);
  });
  it("sends once per moment, never a backlog, never while snoozed", () => {
    const r = { openedAt: t0, remindersSent: 0, snoozedUntil: null };
    expect(shouldSendHeadshotReminder(r, at(0), s)).toBe(true);
    expect(shouldSendHeadshotReminder({ ...r, remindersSent: 1 }, at(2), s)).toBe(false);
    expect(shouldSendHeadshotReminder({ ...r, remindersSent: 1 }, at(3.1), s)).toBe(true);
    // a long gap still sends one, which brings the count up to date
    expect(headshotPointsDue(t0, at(30), s)).toBe(5);
    expect(shouldSendHeadshotReminder({ ...r, remindersSent: 1, snoozedUntil: at(7) }, at(5), s)).toBe(false);
    expect(shouldSendHeadshotReminder({ ...r, remindersSent: 0 }, at(1), { ...s, enabled: false })).toBe(false);
  });
  it("'Remind me later' waits for the next moment, at least half a day", () => {
    expect(snoozeUntil(t0, at(0.1), s).getTime()).toBe(at(3).getTime());
    expect(snoozeUntil(t0, at(2.9), s).getTime()).toBe(at(2.9).getTime() + DAY_MS / 2);
    expect(nextHeadshotPoint(t0, at(14), s)?.getTime()).toBe(at(28).getTime());
  });
  it("can be changed by the admin, and stays sane", () => {
    const custom = sanitizePhotoReminders({ headshot: { follow_up_days: [10, 2, 2, 400], repeat_days: 1 }, crew: { first_days: 3, second_days: 2, repeat_days: 0 }, evidence_retention_days: 99 });
    expect(custom.headshot.followUpDays).toEqual([2, 10, 90]);
    expect(custom.headshot.repeatDays).toBe(3);
    expect(custom.crew.secondDays).toBe(4);
    expect(custom.crew.repeatDays).toBe(0);
    expect(custom.evidenceRetentionDays).toBe(30);
    expect(sanitizePhotoReminders(JSON.stringify(storedPhotoReminders(custom)))).toEqual(custom);
    expect(sanitizePhotoReminders("not json")).toEqual(DEFAULT_PHOTO_REMINDERS);
    expect(headshotScheduleWords(s)).toBe("The request, then after 3, 7 and 14 days, then every 14 days until it's done");
  });
});

describe("Crew picture reminder", () => {
  const s = DEFAULT_PHOTO_REMINDERS.crew;
  const start = new Date("2026-12-01T00:00:00Z");
  const at = (d: number) => new Date(start.getTime() + d * DAY_MS);
  it("comes after 7 days, 14 days, then every 30", () => {
    expect(crewPointDays(s, 120)).toEqual([7, 14, 44, 74, 104]);
  });
  it("shows once per moment until dismissed, and never with a picture", () => {
    const base = { hasCrewPicture: false, accountStart: start, dismissedAt: null, settings: s };
    expect(crewReminderDue({ ...base, now: at(6) })).toBe(false);
    expect(crewReminderDue({ ...base, now: at(7.5) })).toBe(true);
    expect(crewReminderDue({ ...base, now: at(10), dismissedAt: at(8) })).toBe(false);
    expect(crewReminderDue({ ...base, now: at(15), dismissedAt: at(8) })).toBe(true);
    expect(crewReminderDue({ ...base, now: at(40), dismissedAt: at(15) })).toBe(false);
    expect(crewReminderDue({ ...base, now: at(45), dismissedAt: at(15) })).toBe(true);
    expect(crewReminderDue({ ...base, now: at(45), hasCrewPicture: true })).toBe(false);
  });
});

describe("challenge", () => {
  it("always asks for a blink and one head turn, in a random order", () => {
    const seq = [0.1, 0.9, 0.7, 0.2];
    let i = 0;
    const rand = () => seq[i++ % seq.length]!;
    const a = pickChallenge(rand);
    const b = pickChallenge(rand);
    for (const c of [a, b]) {
      expect(c).toHaveLength(2);
      expect(c).toContain("blink");
      expect(c.some((x) => x === "turn_left" || x === "turn_right")).toBe(true);
    }
    expect(a).not.toEqual(b);
  });
});
