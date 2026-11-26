import type { ReactNode } from "react";
import { Users } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { LiveAvatar } from "@/components/live-indicator";
import { CHAT_ROW_AVATAR } from "@/components/messages/chat-list-row";
import { clusterFaces, type GroupFace } from "@/lib/group-row";

/**
 * A group chat's picture: 2–4 of its people in one avatar's footprint
 * (two on a diagonal, three in a triangle, four in a square), initials where
 * there's no photo, "+N" in the last spot when there are more, a group icon
 * with nobody to show. Anyone here now carries the live ring.
 */
export function GroupAvatarCluster({
  faces,
  total,
  size = CHAT_ROW_AVATAR,
  live,
}: {
  faces: readonly GroupFace[];
  /** Everyone it could show (the faces may be the first few). */
  total?: number;
  size?: number;
  live?: ReadonlySet<string>;
}) {
  const { shown, more } = clusterFaces(faces, total ?? faces.length);
  const tiles = shown.length + (more > 0 ? 1 : 0);
  if (tiles === 0) {
    return (
      <span className="pointer-events-none grid shrink-0 place-items-center rounded-full bg-muted text-foreground" style={{ width: size, height: size }} data-group-avatar="empty">
        <Users className={size >= 48 ? "h-6 w-6" : "h-4 w-4"} />
      </span>
    );
  }
  if (tiles === 1) {
    const f = shown[0];
    return <span className="pointer-events-none shrink-0" data-group-avatar="1">{face(f, size, live)}</span>;
  }
  // each face's size and spot, as a share of the footprint
  const s = Math.round(size * (tiles === 2 ? 0.58 : tiles === 3 ? 0.56 : 0.52));
  const spots: Array<[number, number]> =
    tiles === 2 ? [[size - s, 0], [0, size - s]]
      : tiles === 3 ? [[(size - s) / 2, 0], [0, size - s], [size - s, size - s]]
        : [[0, 0], [size - s, 0], [0, size - s], [size - s, size - s]];
  const items: ReactNode[] = shown.map((f, i) => (
    <span key={f.user_id} className="absolute rounded-full ring-2 ring-card" style={{ left: spots[i][0], top: spots[i][1] }}>
      {face(f, s, live)}
    </span>
  ));
  if (more > 0) {
    const [x, y] = spots[shown.length];
    items.push(
      <span
        key="more"
        className="absolute grid place-items-center rounded-full bg-muted font-semibold tabular-nums text-muted-foreground ring-2 ring-card"
        style={{ left: x, top: y, width: s, height: s, fontSize: Math.max(10, Math.round(s * 0.36)) }}
        aria-label={`${more} more`}
        data-group-more
      >
        +{more}
      </span>,
    );
  }
  return (
    <span className="pointer-events-none relative block shrink-0" style={{ width: size, height: size }} data-group-avatar={tiles}>
      {items}
    </span>
  );
}

function face(f: GroupFace, px: number, live?: ReadonlySet<string>) {
  const avatar = <UserAvatar src={f.avatar_url} name={f.name} size={px} tone="neutral" expandable={false} />;
  return live ? <LiveAvatar live={live.has(f.user_id)} size={px} tag={false}>{avatar}</LiveAvatar> : avatar;
}
