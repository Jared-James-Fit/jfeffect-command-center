/**
 * The anatomical drawing, as data (front, back and side views of one body,
 * 400 × 920, midline x = 200). Drawn for JF Effect from standard anatomy
 * (no third-party artwork): an adult in the anatomical position, palms
 * forward, arms slightly out so nothing overlaps the trunk.
 *
 * Paired structures are drawn once, on the screen's left half, and mirrored.
 * On the front view the screen's left is the athlete's RIGHT (they face you);
 * on the back view it's their LEFT. The side view is the right side (facing
 * the screen's right); the left side is its mirror.
 *
 * Draw order is the array order: deeper or covered structures first, what
 * overlies them after (the deltoid over the pec's insertion, sartorius over
 * the inner quad). `deep` parts belong to the "Deeper" layer only.
 *
 * Points: "x,y x,y!" ("!" = a corner). `fiber` is the angle the muscle's
 * fibres run, in degrees clockwise from the screen's +x, for the striation.
 */

export type PartKind = "muscle" | "tendon" | "bone" | "joint" | "skin";

export type PartSpec = {
  site?: string;
  kind: PartKind;
  pts?: string;
  ellipse?: [number, number, number, number];
  fiber?: number;
  deep?: boolean;
  /** Drawn once on the midline (side null). */
  mid?: boolean;
};

export type LineSpec = { pts: string; mid?: boolean; tone?: "tendon" | "groove" };

export type ViewSpec = {
  /** Half the outline, top centre → down the screen's left → crotch / bottom centre. */
  silhouette: string;
  head: string;
  parts: PartSpec[];
  lines: LineSpec[];
};

const HEAD =
  "200,22! 222,25 236,36 243,58 242,84 237,102 230,114 218,126 206,131 194,131 182,126 170,114 163,102 158,84 157,58 164,36 178,25";

const SILHOUETTE =
  "200,22! 178,25 164,36 157,58 158,84 163,102 170,114 176,124 177,138 176,152 166,160 146,166 124,172 106,180 94,192 88,208 86,228 86,256 84,290 82,320 80,342 75,372 68,410 62,444 58,470 52,484 44,496 37,510 34,522 38,528 46,522 54,512 52,530 52,552 56,566 64,574 74,574 80,566 83,546 84,520 85,498 86,482 90,456 98,420 104,388 108,360 110,340 114,312 120,282 126,256 130,244 128,262 127,290 128,320 132,345 136,364 135,390 132,416 126,442 122,468 121,500 123,540 128,580 136,616 142,644 142,664 137,690 134,722 135,756 140,792 146,826 150,850 150,866 146,876 140,890 140,900 150,906 170,906 180,900 180,888 176,872 174,856 178,826 184,790 187,752 185,712 180,684 177,664 177,644 180,620 184,590 189,550 193,510 196,484 200,470!";

const HAND = "84,486 72,486 60,488 56,500 54,520 53,548 57,564 64,572 74,572 80,564 83,544 84,520 85,500";
const THUMB = "58,488 50,492 42,502 36,514 34,522 38,527 46,522 54,512 58,500";

export const FRONT: ViewSpec = {
  silhouette: SILHOUETTE,
  head: HEAD,
  parts: [
    // deep layer (drawn only on "Deeper")
    { site: "scalenes", kind: "muscle", deep: true, pts: "184,128 176,132 172,150 178,166 186,158 187,140", fiber: 75 },
    { site: "pec_minor", kind: "muscle", deep: true, pts: "130,196 140,200 156,218 166,240 168,256 158,256 144,236 132,214", fiber: 60 },
    { site: "hip_flexor", kind: "muscle", deep: true, pts: "186,330 176,340 168,380 160,420 156,450 160,480 168,494 176,486 176,452 180,420 186,380 190,350", fiber: 78 },

    // neck & shoulders
    { kind: "muscle", pts: "186,128 200,132! 214,128 212,150 206,166 200,168! 194,166 188,150", fiber: 92 },
    { site: "neck_side", kind: "muscle", pts: "170,112 176,110 182,128 190,150 197,166 192,169 184,154 174,132", fiber: 67 },
    { site: "upper_trap", kind: "muscle", pts: "178,132 180,146 170,158 150,164 128,170 116,175 122,166 146,158 166,150 174,138", fiber: 160 },
    // chest under the deltoid's front edge
    { site: "upper_chest", kind: "muscle", pts: "197,176! 180,174 162,176 148,180 140,190 134,204 128,222 124,236 132,236 150,226 172,214 197,206!", fiber: 142 },
    { site: "chest", kind: "muscle", pts: "197,206! 172,214 150,226 132,236 124,240 128,248 140,256 154,266 168,276 182,282 197,284!", fiber: 168 },
    { site: "sternum", kind: "bone", mid: true, pts: "197,172! 203,172! 203,284! 197,284!" },
    { kind: "bone", pts: "196,168 182,166 168,166 150,169 130,172 114,176 114,178 130,175 150,172 168,169 182,169 196,171" },
    { site: "side_delt", kind: "muscle", pts: "116,178 104,184 94,194 88,210 87,232 90,252 98,268 104,266 104,244 103,220 106,198", fiber: 95 },
    { site: "front_delt", kind: "muscle", pts: "150,176 134,176 118,180 108,192 104,210 105,234 108,254 102,268 112,262 120,248 128,232 136,214 146,194", fiber: 112 },
    { site: "ac_joint", kind: "joint", ellipse: [118, 179, 5, 4] },
    { site: "shoulder_front", kind: "joint", ellipse: [123, 222, 5, 8] },
    // side of the ribs
    { site: "lats", kind: "muscle", pts: "128,252 130,262 128,284 130,306 134,322 132,330 127,312 125,288 125,264", fiber: 70 },
    { site: "serratus", kind: "muscle", pts: "128,256 140,262 132,268 144,278 134,284 146,296 136,302 146,314 134,320 130,300 128,280", fiber: 28 },
    // abdomen
    { site: "obliques", kind: "muscle", pts: "132,300 140,290 152,272 166,270 174,282 170,300 169,322 169,345 171,372 175,404 181,432 188,452 176,448 158,438 140,430 134,404 132,378 131,350 131,324", fiber: 55 },
    { site: "abs", kind: "muscle", pts: "198,270! 184,272 174,282 170,300 169,322 169,345 171,372 175,404 181,432 189,452 198,460!", fiber: 90 },
    // arm
    { site: "triceps", kind: "muscle", pts: "126,258 129,262 124,290 118,318 112,340 108,344 114,322 120,292", fiber: 95 },
    { site: "brachialis", kind: "muscle", pts: "98,296 90,300 87,322 89,340 96,346 100,340 98,320", fiber: 95 },
    { site: "biceps", kind: "muscle", pts: "122,256 110,262 102,280 98,304 98,326 101,342 108,346 114,330 119,306 124,280", fiber: 92 },
    { site: "brachioradialis", kind: "muscle", pts: "92,336 84,342 78,364 72,396 67,430 62,462 60,474 66,476 72,448 80,414 88,384 94,360", fiber: 100 },
    { site: "forearm_flexors", kind: "muscle", pts: "108,354 98,352 92,368 86,400 78,436 70,466 66,476 80,480 86,460 94,426 102,392 106,370", fiber: 102 },
    { site: "elbow_front", kind: "tendon", ellipse: [102, 346, 4, 6] },
    { site: "elbow_outer", kind: "joint", ellipse: [85, 342, 5, 7] },
    { site: "elbow_inner", kind: "joint", ellipse: [110, 351, 5, 7] },
    { site: "wrist_front", kind: "joint", ellipse: [72, 481, 13, 6] },
    { site: "hand", kind: "skin", pts: HAND },
    { site: "thumb", kind: "skin", pts: THUMB },
    // hip & groin
    { site: "tfl", kind: "muscle", pts: "142,428 132,436 125,452 122,470 124,490 132,494 136,476 140,456 146,438", fiber: 98 },
    { site: "hip_outer", kind: "joint", ellipse: [125, 476, 5, 9] },
    { site: "hip_flexor", kind: "muscle", pts: "160,440 154,452 160,474 170,488 177,474 177,456 170,444", fiber: 80 },
    { site: "groin", kind: "muscle", pts: "176,450 176,470 178,486 186,488 192,474 190,458", fiber: 60 },
    { site: "adductors", kind: "muscle", pts: "190,462 182,472 176,490 172,512 172,532 178,530 186,508 194,480", fiber: 70 },
    { site: "adductors", kind: "muscle", pts: "196,474 192,498 188,540 184,580 182,616 180,636 184,636 188,604 192,560 196,520 198,490", fiber: 86 },
    // thigh
    { site: "vastus_lateralis", kind: "muscle", pts: "134,474 125,492 122,524 124,560 129,596 137,626 147,640 152,630 146,604 141,572 140,536 143,500 146,482", fiber: 84 },
    { site: "rectus_femoris", kind: "muscle", pts: "150,476 143,500 140,536 141,572 146,604 154,626 160,628 166,606 168,570 166,532 160,500 156,480", fiber: 90 },
    { site: "vmo", kind: "muscle", pts: "170,556 164,580 160,606 162,630 170,642 180,636 182,614 180,588 176,568", fiber: 66 },
    { site: "sartorius", kind: "muscle", pts: "142,426 148,430 160,462 170,500 178,544 183,590 184,626 178,640 174,628 172,592 168,548 160,504 150,468 140,436", fiber: 70 },
    // knee
    { site: "quad_tendon", kind: "tendon", pts: "150,625 166,625 166,636 150,638" },
    { site: "kneecap", kind: "bone", ellipse: [158, 650, 11, 13] },
    { site: "patellar_tendon", kind: "tendon", pts: "152,662 164,662 163,688 155,688" },
    { site: "knee_inner", kind: "joint", ellipse: [175, 654, 5, 11] },
    { site: "knee_outer", kind: "joint", ellipse: [143, 656, 5, 11] },
    // lower leg
    { site: "calf_inner", kind: "muscle", pts: "170,674 168,700 170,740 174,768 180,760 185,730 184,700 179,680", fiber: 92 },
    { site: "soleus", kind: "muscle", pts: "170,772 168,800 170,826 176,826 181,800 183,772 178,770", fiber: 90 },
    { site: "peroneals", kind: "muscle", pts: "140,694 136,716 135,750 138,790 143,820 145,806 142,770 141,736 143,708", fiber: 92 },
    { site: "tibialis", kind: "muscle", pts: "154,690 147,708 144,740 146,780 150,820 155,846 159,842 157,806 156,766 157,726 159,700", fiber: 92 },
    { site: "shin_inner", kind: "bone", pts: "161,690 166,700 169,740 168,790 165,830 161,850 158,846 160,800 160,750 159,710" },
    // ankle & foot
    { site: "foot_top", kind: "skin", pts: "150,872 144,884 141,898 150,904 170,904 178,898 176,884 172,872" },
    { site: "ankle_front", kind: "joint", ellipse: [161, 866, 10, 5] },
    { site: "ankle_inner", kind: "joint", ellipse: [176, 859, 4, 6] },
    { site: "ankle_outer", kind: "joint", ellipse: [147, 864, 4, 6] },
  ],
  lines: [
    { pts: "200,272 200,460", mid: true, tone: "tendon" },
    { pts: "62,550 63,571", tone: "groove" },
    { pts: "69,548 70,573", tone: "groove" },
    { pts: "76,546 76,569", tone: "groove" },
    { pts: "170,320 184,318 198,318", tone: "tendon" },
    { pts: "170,346 184,345 198,346", tone: "tendon" },
    { pts: "172,374 186,373 198,374", tone: "tendon" },
    { pts: "142,426 160,438 178,450 192,460", tone: "groove" },
  ],
};

export const BACK: ViewSpec = {
  silhouette: SILHOUETTE,
  head: HEAD,
  parts: [
    // deep layer
    { site: "levator_scap", kind: "muscle", deep: true, pts: "186,112 178,114 170,150 164,196 170,202 178,170 186,136", fiber: 105 },
    { site: "supraspinatus", kind: "muscle", deep: true, pts: "166,200 146,194 126,186 118,182 122,178 146,182 166,190", fiber: 175 },
    { site: "rhomboids", kind: "muscle", deep: true, pts: "198,180 186,184 172,196 166,214 164,244 162,268 172,266 186,238 198,214", fiber: 30 },
    { site: "ql", kind: "muscle", deep: true, pts: "186,372 172,374 162,396 162,426 176,434 188,424", fiber: 80 },
    { site: "glute_min", kind: "muscle", deep: true, pts: "176,434 156,434 138,444 134,462 150,462 168,452", fiber: 70 },
    { site: "piriformis", kind: "muscle", deep: true, pts: "196,474 178,476 156,482 138,488 138,496 158,494 178,490 196,488", fiber: 172 },

    // back of the trunk
    { site: "lats", kind: "muscle", pts: "156,280 140,286 126,286 120,298 121,324 125,352 131,380 140,404 154,416 172,412 184,388 188,350 190,310 188,276 176,268 166,276", fiber: 60 },
    { site: "obliques", kind: "muscle", pts: "126,352 122,380 126,408 138,426 146,420 136,396 130,370", fiber: 50 },
    { site: "erectors_mid", kind: "muscle", pts: "197,236! 188,238 184,270 183,310 182,340 182,362 197,362!", fiber: 90 },
    { site: "erectors_low", kind: "muscle", pts: "197,362! 182,362 176,388 175,416 178,440 188,452 197,452!", fiber: 90 },
    { site: "upper_trap", kind: "muscle", pts: "184,116 180,140 168,156 146,166 124,174 114,180 126,186 150,186 174,182 192,176 198,172 198,160 186,152 182,136", fiber: 150 },
    { site: "mid_trap", kind: "muscle", pts: "198,172! 192,176 174,182 150,186 130,190 142,200 160,206 178,212 198,218!", fiber: 178 },
    { site: "lower_trap", kind: "muscle", pts: "198,218! 178,212 166,214 170,236 178,262 186,290 194,316 198,334!", fiber: 72 },
    { site: "neck_back", kind: "muscle", pts: "198,98! 190,102 184,118 182,138 186,154 198,160!", fiber: 95 },
    { site: "neck_spine", kind: "bone", mid: true, pts: "197,104! 203,104! 203,170! 197,170!" },
    { site: "upper_spine", kind: "bone", mid: true, pts: "197,172! 203,172! 203,250! 197,250!" },
    { site: "mid_spine", kind: "bone", mid: true, pts: "197,250! 203,250! 203,362! 197,362!" },
    { site: "low_spine", kind: "bone", mid: true, pts: "197,362! 203,362! 203,452! 197,452!" },
    // shoulder blade
    { site: "teres_major", kind: "muscle", pts: "136,266 120,268 112,276 118,288 134,294 150,292 158,282 154,270", fiber: 14 },
    { site: "infraspinatus", kind: "muscle", pts: "164,212 146,206 126,200 116,210 114,228 120,244 134,256 152,264 162,262 166,236", fiber: 36 },
    { site: "teres_minor", kind: "muscle", pts: "116,232 110,244 112,256 124,266 136,266 134,258 122,248", fiber: 18 },
    { site: "scapula_border", kind: "bone", pts: "166,208 170,209 168,240 164,268 158,281 154,279 160,264 164,240" },
    { kind: "bone", pts: "166,204 146,198 126,190 116,184 116,188 128,194 146,203 165,209" },
    { site: "side_delt", kind: "muscle", pts: "114,180 102,186 92,196 87,212 86,234 90,254 100,268 98,246 96,222 102,200", fiber: 95 },
    { site: "rear_delt", kind: "muscle", pts: "140,192 124,188 108,190 98,202 93,222 95,246 100,266 108,262 112,242 120,224 132,210", fiber: 68 },
    // arm
    { site: "triceps", kind: "muscle", pts: "104,264 94,268 88,288 87,312 92,330 100,322 104,296", fiber: 95 },
    { site: "triceps", kind: "muscle", pts: "124,262 114,264 106,282 104,310 106,330 112,334 118,312 124,288", fiber: 92 },
    { site: "elbow_back", kind: "joint", ellipse: [101, 347, 7, 8] },
    { site: "brachioradialis", kind: "muscle", pts: "88,338 82,344 76,370 70,404 66,436 70,438 76,404 84,372 90,350", fiber: 100 },
    { site: "forearm_flexors", kind: "muscle", pts: "108,354 104,370 98,410 88,450 82,474 86,476 94,448 104,410 110,370", fiber: 100 },
    { site: "forearm_extensors", kind: "muscle", pts: "102,356 92,356 84,378 78,410 72,444 68,470 80,476 88,444 96,410 102,378", fiber: 102 },
    { site: "wrist_back", kind: "joint", ellipse: [72, 481, 13, 6] },
    { site: "hand", kind: "skin", pts: HAND },
    { site: "thumb", kind: "skin", pts: THUMB },
    // hip & glute
    { site: "glute_med", kind: "muscle", pts: "178,428 158,428 138,436 128,450 126,468 140,474 160,466 176,452 184,440", fiber: 78 },
    { site: "glute_max", kind: "muscle", pts: "198,452! 186,446 166,458 146,472 130,490 128,516 134,540 152,556 178,560 198,552!", fiber: 148 },
    { site: "si_joint", kind: "joint", ellipse: [189, 457, 5, 9] },
    { site: "tailbone", kind: "bone", mid: true, ellipse: [200, 488, 5, 8] },
    // thigh
    { site: "it_band", kind: "tendon", pts: "130,500 124,540 126,590 132,634 138,642 136,600 132,556 134,512" },
    { site: "adductors", kind: "muscle", pts: "196,546 188,560 188,600 184,632 188,634 194,604 197,574", fiber: 88 },
    { site: "hamstring_outer", kind: "muscle", pts: "152,556 138,560 132,588 134,618 142,644 152,650 156,624 158,590", fiber: 95 },
    { site: "hamstring_inner", kind: "muscle", pts: "180,560 160,558 158,592 160,626 166,650 176,650 184,622 188,590", fiber: 85 },
    { site: "high_hamstring", kind: "tendon", ellipse: [168, 561, 10, 6] },
    // knee & lower leg
    { site: "knee_back", kind: "joint", ellipse: [160, 662, 12, 9] },
    { site: "calf_outer", kind: "muscle", pts: "156,672 144,680 138,708 139,740 146,766 154,772 158,742 158,702", fiber: 95 },
    { site: "calf_inner", kind: "muscle", pts: "162,672 160,702 160,742 166,778 176,782 184,756 186,722 182,692 172,676", fiber: 85 },
    { site: "soleus", kind: "muscle", pts: "140,744 138,776 146,806 158,816 172,812 180,792 184,764 178,780 166,780 156,774 146,768", fiber: 90 },
    { site: "achilles", kind: "tendon", pts: "156,808 166,808 166,860 156,860" },
    { site: "heel", kind: "joint", ellipse: [161, 886, 12, 12] },
    { site: "ankle_outer", kind: "joint", ellipse: [147, 864, 4, 6] },
    { site: "ankle_inner", kind: "joint", ellipse: [176, 859, 4, 6] },
  ],
  lines: [
    { pts: "62,550 63,571", tone: "groove" },
    { pts: "69,548 70,573", tone: "groove" },
    { pts: "76,546 76,569", tone: "groove" },
  ],
};

const SIDE_HEAD =
  "196,22 214,26 230,38 238,58 240,68 248,80 250,86 244,90 244,96 240,100 242,106 238,112 238,120 230,126 218,128 206,124 194,120 182,118 172,108 166,90 166,64 172,42 182,28";

/** The right side, facing the screen's right (front at higher x). The arm hangs over the trunk, drawn last. */
export const SIDE: ViewSpec = {
  silhouette:
    "196,22 214,26 230,38 238,58 240,68 248,80 250,86 244,90 244,96 240,100 242,106 238,112 238,120 230,126 220,130 218,146 222,166 236,184 248,206 252,228 248,250 242,274 240,300 242,340 242,380 238,410 232,440 226,462 232,490 238,530 240,570 236,610 232,640 238,652 234,672 228,700 226,750 222,800 220,840 222,866 234,876 252,888 266,898 268,904! 264,907 196,907 178,902 172,890 176,870 178,840 176,812 170,780 164,740 164,706 170,684 176,668 176,650 174,610 170,570 166,530 160,500 158,474 164,448 174,424 182,396 180,366 172,330 166,290 164,250 166,214 172,186 180,160 182,140 178,124 170,110 166,90 166,64 172,42 182,28",
  head: SIDE_HEAD,
  parts: [
    // trunk (behind the arm)
    { kind: "skin", pts: "188,80 194,78 196,90 192,96 186,92" },
    { site: "neck_back", kind: "muscle", pts: "170,100 182,104 186,124 182,140 174,132 170,116", fiber: 95 },
    { site: "upper_trap", kind: "muscle", pts: "180,122 188,132 196,160 206,182 196,188 184,172 176,150 176,132", fiber: 78 },
    { site: "neck_side", kind: "muscle", pts: "188,106 196,104 210,130 222,160 220,168 210,154 196,126", fiber: 60 },
    { site: "chest", kind: "muscle", pts: "222,176 238,188 250,220 248,238 236,246 226,238 222,210", fiber: 170 },
    { site: "lats", kind: "muscle", pts: "168,250 182,240 186,270 186,320 190,360 186,392 178,410 172,380 168,330 166,290", fiber: 70 },
    { site: "erectors_mid", kind: "muscle", pts: "166,282 172,282 176,330 180,366 172,370 168,330", fiber: 90 },
    { site: "erectors_low", kind: "muscle", pts: "176,370 184,366 186,400 182,430 172,436 172,400", fiber: 90 },
    { site: "serratus", kind: "muscle", pts: "230,236 244,240 238,250 246,262 236,268 244,282 232,288 228,270 228,250", fiber: 25 },
    { site: "obliques", kind: "muscle", pts: "196,300 226,296 238,310 240,350 238,390 230,416 210,424 194,414 190,380 192,340", fiber: 55 },
    { site: "abs", kind: "muscle", pts: "238,300 242,300 244,340 242,380 236,420 232,420 236,380 238,340", fiber: 90 },
    // hip & thigh
    { site: "glute_med", kind: "muscle", pts: "176,430 200,428 214,440 212,468 196,476 180,466 170,450", fiber: 85 },
    { site: "glute_max", kind: "muscle", pts: "164,452 180,462 198,478 206,500 200,528 184,536 168,528 160,500 160,474", fiber: 140 },
    { site: "tfl", kind: "muscle", pts: "214,438 228,444 232,462 226,486 216,496 210,478 212,456", fiber: 100 },
    { site: "hamstring_outer", kind: "muscle", pts: "168,532 184,540 200,546 200,600 194,640 182,650 176,620 172,580", fiber: 95 },
    { site: "vastus_lateralis", kind: "muscle", pts: "214,500 228,504 234,540 234,590 228,630 214,644 212,610 214,560", fiber: 85 },
    { site: "rectus_femoris", kind: "muscle", pts: "228,490 236,500 240,540 238,590 232,628 228,626 232,586 232,540", fiber: 88 },
    { site: "it_band", kind: "tendon", pts: "200,500 212,498 214,540 214,590 212,630 206,646 200,640 202,600 202,550" },
    { site: "hip_outer", kind: "joint", ellipse: [194, 492, 6, 8] },
    // knee & lower leg
    { site: "knee_back", kind: "joint", ellipse: [180, 660, 7, 9] },
    { site: "knee_outer", kind: "joint", ellipse: [212, 660, 7, 10] },
    { site: "kneecap", kind: "bone", ellipse: [233, 652, 5, 12] },
    { site: "patellar_tendon", kind: "tendon", pts: "226,664 234,664 232,690 226,690" },
    { site: "calf_outer", kind: "muscle", pts: "176,676 190,680 196,710 194,750 186,776 176,770 168,740 168,704", fiber: 92 },
    { site: "soleus", kind: "muscle", pts: "170,744 186,760 196,770 200,800 192,826 182,820 176,790", fiber: 90 },
    { site: "peroneals", kind: "muscle", pts: "200,690 210,690 212,740 210,790 206,830 200,840 198,800 198,740", fiber: 92 },
    { site: "tibialis", kind: "muscle", pts: "214,688 226,690 226,740 222,800 218,840 212,840 212,790 212,740", fiber: 92 },
    { site: "achilles", kind: "tendon", pts: "180,820 188,822 186,866 178,864" },
    { site: "foot_top", kind: "skin", pts: "206,872 226,874 250,888 262,898 266,904 214,904 198,900" },
    { site: "arch", kind: "tendon", pts: "204,902 248,902 238,906 210,906" },
    { site: "heel", kind: "joint", ellipse: [184, 892, 10, 9] },
    { site: "ankle_outer", kind: "joint", ellipse: [204, 866, 6, 7] },
    { site: "ankle_front", kind: "joint", ellipse: [222, 868, 5, 6] },
    // the arm, over the trunk
    { kind: "skin", pts: "200,180 226,196 228,224 222,260 218,300 216,340 220,350 226,380 226,420 222,460 220,480 196,480 194,440 190,400 184,360 182,344 180,300 178,260 180,220 184,196 192,184" },
    { site: "triceps", kind: "muscle", pts: "184,214 196,222 202,260 204,300 200,334 190,342 182,330 180,290 180,250", fiber: 95 },
    { site: "brachialis", kind: "muscle", pts: "206,286 214,290 214,320 212,342 204,342 202,318", fiber: 95 },
    { site: "biceps", kind: "muscle", pts: "220,250 226,262 224,296 220,330 216,344 212,330 212,296 214,268", fiber: 92 },
    { site: "rear_delt", kind: "muscle", pts: "188,186 198,184 198,210 200,240 204,266 196,262 188,240 184,214 184,196", fiber: 75 },
    { site: "side_delt", kind: "muscle", pts: "198,184 214,184 214,210 210,240 206,268 200,240 198,210", fiber: 92 },
    { site: "front_delt", kind: "muscle", pts: "214,184 222,188 228,206 228,228 222,248 210,266 210,240 214,210", fiber: 108 },
    { site: "ac_joint", kind: "joint", ellipse: [206, 182, 5, 4] },
    { site: "forearm_extensors", kind: "muscle", pts: "196,354 210,356 212,390 210,430 206,466 198,470 194,440 192,400 190,370", fiber: 100 },
    { site: "brachioradialis", kind: "muscle", pts: "214,346 222,352 226,380 224,410 216,430 210,410 210,380", fiber: 98 },
    { site: "forearm_flexors", kind: "muscle", pts: "222,404 226,420 222,460 218,476 212,470 214,440", fiber: 100 },
    { site: "elbow_outer", kind: "joint", ellipse: [200, 350, 6, 7] },
    { site: "elbow_back", kind: "joint", ellipse: [185, 346, 5, 6] },
    { site: "wrist_back", kind: "joint", ellipse: [204, 481, 8, 5] },
    { site: "wrist_front", kind: "joint", ellipse: [218, 481, 5, 5] },
    { site: "hand", kind: "skin", pts: "200,484 216,482 224,500 226,540 222,566 214,574 206,568 202,540 200,504" },
    { site: "thumb", kind: "skin", pts: "220,486 230,494 234,512 230,520 224,510" },
  ],
  lines: [],
};
