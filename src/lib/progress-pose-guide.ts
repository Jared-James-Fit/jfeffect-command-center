/**
 * How to take progress photos and videos the same way every time, so the only
 * thing that changes between check-ins is the athlete. The words for the pose
 * tiles and the "How to take them" guide (pose-guide.tsx). Pure, so it's tested.
 */
export type PoseAngle = "front" | "left" | "back" | "right";

export const POSE_ORDER: PoseAngle[] = ["front", "left", "back", "right"];

/** The one line under each pose: which way to face and where the arms go. */
export const POSE_CUES: Record<PoseAngle, string> = {
  front: "Face the camera, arms a little out",
  left: "Left side to the camera, arms a little forward",
  back: "Back to the camera, arms a little out",
  right: "Right side to the camera, arms a little forward",
};

/** Why each pose is set that way (the guide's longer line). */
export const POSE_DETAIL: Record<PoseAngle, string> = {
  front: "Feet hip-width, arms hanging a few inches away from your sides so your waist shows.",
  left: "Turn to your right so your left side faces the camera. Arms relaxed and a little in front of you so they don't cover your waist or back.",
  back: "Turn around, same stance as the front. Arms a little out, hair up off your neck and shoulders.",
  right: "Turn to your left so your right side faces the camera. Same as the left side.",
};

export const PHOTO_SETUP: Array<{ title: string; body: string }> = [
  { title: "Same time", body: "First thing in the morning, after the bathroom and before you eat or drink." },
  { title: "Same spot, good light", body: "Bright, even light coming from in front of you. No window or lamp behind you, and not only a light straight overhead." },
  { title: "Phone at belly-button height", body: "Upright (portrait), about 6 to 8 feet away. Prop it up and use the timer, or have someone take them." },
  { title: "Whole body in the frame", body: "Head to feet, with a little space above your head and below your feet." },
  { title: "Wear what you're comfortable in", body: "Anything that shows your full physique: underwear, shorts, a sports bra or no shirt all work. The more of you we can see, the better. Wear the same thing every time." },
  { title: "Stand relaxed and tall", body: "Don't flex, pose or suck in. Just stand like you normally would." },
];

/** Single video: one take, turning a quarter turn at a time. */
export const VIDEO_STEPS: string[] = [
  "Set up the same way as photos: same spot, same light, phone at belly-button height, 6 to 8 feet away, whole body in the frame.",
  "Start the video facing the camera and hold still for about 3 seconds.",
  "Turn a quarter turn to your right and hold 3 seconds (your left side). Again for your back, again for your right side, then back to the front.",
  "Relaxed the whole time. About 20 seconds is plenty.",
];

export const SINGLE_VIDEO_CUE = "Front, left, back, right · 3 seconds each";
