/** A point of the plate's track: where its centre was in one frame, its measured size, and whether it was seen. */
export type TrackPoint = {
  t: number;
  /** Centre (frame pixels; y down) and size; a / b the rim's horizontal / vertical semi-axes (NaN when not measured). */
  x: number;
  y: number;
  r: number;
  a: number;
  b: number;
  /** 0…1: the share of the rim that showed (0 when lost or not measured). */
  conf: number;
  found: boolean;
};
