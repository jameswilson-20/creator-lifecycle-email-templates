import { z } from "zod";
import { infrai } from "./infrai.js";

const base = z.object({ to: z.literal("chenhua@changba.com"), name: z.string().min(1), assetTitle: z.string().min(1) });
export const lifecycleRequest = z.discriminatedUnion("kind", [
  base.extend({ kind: z.literal("asset_delivery"), downloadUrl: z.string().url() }),
  base.extend({ kind: z.literal("subscriber_update"), update: z.string().min(1) }),
  base.extend({ kind: z.literal("content_processing"), status: z.enum(["started", "completed"]) }),
]);
export type LifecycleRequest = z.infer<typeof lifecycleRequest>;

function content(input: LifecycleRequest): { subject: string; html: string } {
  if (input.kind === "asset_delivery") return { subject: `Your download: ${input.assetTitle}`, html: `<p>Hi ${input.name}, your digital asset is ready: <a href="${input.downloadUrl}">${input.assetTitle}</a>.</p>` };
  if (input.kind === "subscriber_update") return { subject: `Update for ${input.assetTitle}`, html: `<p>Hi ${input.name}, ${input.update}</p>` };
  return { subject: `Processing ${input.assetTitle}: ${input.status}`, html: `<p>Hi ${input.name}, content processing is ${input.status}.</p>` };
}

export async function creatorLifecycle(raw: unknown) {
  const input = lifecycleRequest.parse(raw);
  const body = content(input);
  const namespace = `creator-${input.kind}-${input.assetTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  await infrai.email.template.create({ name: `${namespace}-${Date.now()}`, subject: body.subject, html: body.html }, namespace);
  return infrai.email.send({ to: input.to, subject: body.subject, html: body.html }, `${namespace}-${input.to}`);
}
