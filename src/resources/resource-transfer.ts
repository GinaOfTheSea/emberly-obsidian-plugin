/** Small recoverable file operation, not a second resource database. */
import { hasAsciiControl } from "../shared/text-validation";
export interface TransferCopy { from: string; to: string; hash: string; }
export interface ResourceTransfer {
  version: 1;
  id: string;
  source: string;
  destination: string;
  sourceAssets: string;
  destinationAssets: string;
  before: string;
  after: string;
  copies: TransferCopy[];
}
export interface TransferIO {
  read(path: string): Promise<string | undefined>;
  readBinary(path: string): Promise<ArrayBuffer>;
  exists(path: string): boolean;
  createBinary(path: string, bytes: ArrayBuffer): Promise<void>;
  compareAndWrite(path: string, before: string, after: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  journal(value: ResourceTransfer | null): Promise<void>;
  validate(plan: ResourceTransfer): Promise<void>;
  cleanup(copy: TransferCopy): Promise<boolean>;
}
export function safeVaultPath(path: unknown): path is string {
  return typeof path === "string" && Boolean(path) && !path.includes(":") && !path.includes("\\") && !hasAsciiControl(path)
    && path.split("/").every((part) => Boolean(part) && part !== "." && part !== ".." && !part.startsWith("."));
}
export async function byteHash(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function validateTransfer(value: unknown): ResourceTransfer {
  if (!value || typeof value !== "object") throw new Error("Invalid pending resource transfer.");
  const plan = value as ResourceTransfer;
  if (plan.version !== 1 || typeof plan.id !== "string" || !/^[a-z0-9-]+$/i.test(plan.id)
    || ![plan.source, plan.destination, plan.sourceAssets, plan.destinationAssets].every(safeVaultPath)
    || !plan.source.endsWith(".md") || !plan.destination.endsWith(".md")
    || plan.source === plan.destination || plan.sourceAssets === plan.destinationAssets
    || !plan.sourceAssets.endsWith("/Assets") || !plan.destinationAssets.endsWith("/Assets")
    || !plan.destination.startsWith(plan.destinationAssets.slice(0, -6) + "Resources/")
    || typeof plan.before !== "string" || typeof plan.after !== "string" || plan.before === plan.after
    || !Array.isArray(plan.copies) || plan.copies.length > 1000) throw new Error("Invalid pending resource transfer. No files were changed.");
  const destinations = new Set<string>();
  for (const copy of plan.copies) {
    if (!safeVaultPath(copy.from) || !safeVaultPath(copy.to) || !copy.to.startsWith(plan.destinationAssets + "/")
      || copy.from === copy.to || !/^[a-f0-9]{64}$/.test(copy.hash) || destinations.has(copy.to.toLowerCase())) {
      throw new Error("Unsafe pending attachment transfer. No files were changed.");
    }
    destinations.add(copy.to.toLowerCase());
  }
  return plan;
}

/** A crash is resolved by comparing actual note content, not trusting a stage flag. */
export async function finishResourceTransfer(io: TransferIO, input: ResourceTransfer, recovering = false): Promise<{ path: string; kept: string[] }> {
  const plan = validateTransfer(input);
  const source = await io.read(plan.source), destination = await io.read(plan.destination);
  if (source !== undefined && destination !== undefined) throw new Error("Both resource paths exist. Resolve the collision before recovering this move.");
  const committed = source === plan.after || (source === undefined && destination === plan.after);
  if (!committed && source !== plan.before) throw new Error("The resource was edited or moved outside this operation. Pending files were kept; inspect the transfer before continuing.");
  await io.validate(plan);
  if (!recovering) await io.journal(plan);
  for (const copy of plan.copies) {
    if (!io.exists(copy.to)) {
      if (committed) throw new Error(`A committed attachment is missing: ${copy.to}. Restore it before recovering.`);
      const bytes = await io.readBinary(copy.from);
      if (await byteHash(bytes) !== copy.hash) throw new Error(`Attachment changed during transfer: ${copy.from}. All originals were kept.`);
      await io.createBinary(copy.to, bytes);
    } else if (!recovering) {
      throw new Error(`An attachment appeared at ${copy.to}. Nothing was overwritten; recover or inspect this move.`);
    }
    if (await byteHash(await io.readBinary(copy.to)) !== copy.hash) throw new Error(`Attachment verification failed: ${copy.to}. All originals were kept.`);
  }
  if (!committed) {
    await io.validate(plan);
    for (const copy of plan.copies) {
      if (await byteHash(await io.readBinary(copy.from)) !== copy.hash) throw new Error(`Original attachment changed before ownership could be saved: ${copy.from}. Originals were kept.`);
    }
    await io.compareAndWrite(plan.source, plan.before, plan.after);
  }
  if (source !== undefined) await io.rename(plan.source, plan.destination);
  // Link-update plugins or an editor may have changed the moved note. Never
  // remove original attachments unless the prepared resource still matches.
  const kept: string[] = [];
  if (await io.read(plan.destination) === plan.after) {
    for (const copy of plan.copies) {
      if (!copy.from.startsWith(plan.sourceAssets + "/") || !await io.cleanup(copy)) kept.push(copy.from);
    }
  } else kept.push(...plan.copies.map((copy) => copy.from));
  await io.journal(null);
  return { path: plan.destination, kept };
}
