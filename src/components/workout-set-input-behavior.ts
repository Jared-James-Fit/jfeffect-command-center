// Canonical workout logger behavior. Keep all set-table implementations wired
// through this module so reps/RPE/weight behave consistently on mobile and web.
export {
  cascadeSetInput,
  defaultProgrammedSetInputs,
  inheritNewSetInputs,
  topEndProgrammedTarget,
} from "@/lib/set-input-cascade";
