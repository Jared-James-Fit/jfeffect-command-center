/**
 * Asking the database what Cleo may do (server only). `callerHasFeature`
 * asks with the caller's own session (`cleo_feature`: their two-step sign-in
 * counts); `userHasFeature` asks the service role about anyone (the background
 * job, `cleo_has_feature`). Before the capability migration is in a database,
 * the rule it replaces: the business owner has everything, a coach or admin
 * has Assist, nobody has Automation.
 */
import { levelOfFeature, readCapabilities, type FeatureKey, type MyCapabilities } from "@/lib/cleo-capabilities";
import { isMissingFunction } from "@/lib/cleo-access.server";

async function fallback(sb: any, userId: string, key: string): Promise<boolean> {
  const [owner, admin, coach] = await Promise.all([
    sb.rpc("is_business_owner", { _uid: userId }),
    sb.rpc("has_role", { _user_id: userId, _role: "admin" }),
    sb.rpc("has_role", { _user_id: userId, _role: "coach" }),
  ]);
  if (owner.data === true) return true;
  return levelOfFeature(key) === "assist" && (admin.data === true || coach.data === true);
}

export async function callerHasFeature(sb: any, userId: string, key: FeatureKey): Promise<boolean> {
  const { data, error } = await sb.rpc("cleo_feature", { _key: key });
  if (!error) return data === true;
  if (!isMissingFunction(error)) throw new Error(`Couldn't check what you can use: ${error.message}`);
  return fallback(sb, userId, key);
}

export async function assertCallerFeature(sb: any, userId: string, key: FeatureKey, message = "That isn't part of your plan."): Promise<void> {
  if (!(await callerHasFeature(sb, userId, key))) throw new Error(message);
}

/** The server's question about anyone (service role). */
export async function userHasFeature(admin: any, userId: string, key: FeatureKey): Promise<boolean> {
  const { data, error } = await admin.rpc("cleo_has_feature", { _uid: userId, _key: key });
  if (!error) return data === true;
  if (!isMissingFunction(error)) throw new Error(`Couldn't check capabilities: ${error.message}`);
  return fallback(admin, userId, key);
}

export async function callerCapabilities(sb: any, userId: string): Promise<MyCapabilities> {
  const { data, error } = await sb.rpc("cleo_my_capabilities");
  if (!error) return readCapabilities(data);
  if (!isMissingFunction(error)) throw new Error(`Couldn't check what you can use: ${error.message}`);
  const { CAPABILITY_FEATURES } = await import("@/lib/cleo-capabilities");
  const have: string[] = [];
  for (const f of CAPABILITY_FEATURES) if (await fallback(sb, userId, f.key)) have.push(f.key);
  return readCapabilities({ features: have });
}
