import fs from 'node:fs';
import path from 'node:path';
import { desc, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { config } from '../config';
import { db } from '../db/client';
import { lots as lotsTable, photos, type Photo } from '../db/schema';
import { getContract } from './contracts';
import { DomainError, notFound } from './errors';
import { appendLotEvent } from './trace';
import type { GradingImage } from '../providers/grading/index';

const PHOTO_STATES = ['FUNDS_HELD', 'PICKUP_CONFIRMED', 'DISPUTED'] as const;

/**
 * Attach a pickup photo to a contract's lot. Resized to ≤1024px JPEG — this is
 * both storage hygiene and the HF payload slimming (images go up as base64).
 */
export async function addPhoto(opts: {
  contractId: string;
  buffer: Buffer;
  actor: { type: 'farmer' | 'buyer'; id: string };
}): Promise<Photo> {
  const contract = getContract(opts.contractId);
  if (!(PHOTO_STATES as readonly string[]).includes(contract.state)) {
    throw new DomainError(`Cannot add photos to a contract in ${contract.state}`, 'INVALID_STATE', 409);
  }

  const processed = await sharp(opts.buffer)
    .rotate() // respect EXIF orientation from phone cameras
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  const fileName = `${crypto.randomUUID()}.jpg`;
  const dir = path.join(config.storageDir, 'photos', contract.lotId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), processed);

  return db.transaction((tx) => {
    const photo = tx
      .insert(photos)
      .values({
        lotId: contract.lotId,
        contractId: contract.id,
        path: path.posix.join('photos', contract.lotId, fileName), // posix — it becomes a URL
        mime: 'image/jpeg',
        bytes: processed.byteLength,
      })
      .returning()
      .get();
    appendLotEvent(tx, {
      lotId: contract.lotId,
      type: 'PHOTO_ADDED',
      actorType: opts.actor.type,
      actorId: opts.actor.id,
      payload: { photoId: photo.id, bytes: processed.byteLength },
    });
    return photo;
  });
}

/**
 * Attach a LISTING photo to a lot (D-036) — a smartphone seller showing their
 * produce on the marketplace card. Same pipeline as pickup photos; the row has
 * no contractId, which is what distinguishes card art from grading evidence.
 */
export async function addLotPhoto(opts: { lotId: string; farmerId: string; buffer: Buffer }): Promise<Photo> {
  const lot = db.select().from(lotsTable).where(eq(lotsTable.id, opts.lotId)).get();
  if (!lot) throw notFound('lot');
  if (lot.farmerId !== opts.farmerId) throw new DomainError('Not your lot', 'FORBIDDEN', 403);
  if (!['registered', 'matched'].includes(lot.status)) {
    throw new DomainError(`Cannot add listing photos to a ${lot.status} lot`, 'INVALID_STATE', 409);
  }

  const processed = await sharp(opts.buffer)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  const fileName = `${crypto.randomUUID()}.jpg`;
  const dir = path.join(config.storageDir, 'photos', lot.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), processed);

  return db.transaction((tx) => {
    const photo = tx
      .insert(photos)
      .values({
        lotId: lot.id,
        contractId: null,
        path: path.posix.join('photos', lot.id, fileName),
        mime: 'image/jpeg',
        bytes: processed.byteLength,
      })
      .returning()
      .get();
    appendLotEvent(tx, {
      lotId: lot.id,
      type: 'PHOTO_ADDED',
      actorType: 'farmer',
      actorId: opts.farmerId,
      payload: { photoId: photo.id, bytes: processed.byteLength, stage: 'listing' },
    });
    return photo;
  });
}

/** Listing photos only — the card art (no contractId; pickup photos have one). */
export function listListingPhotos(lotId: string): Photo[] {
  return db
    .select()
    .from(photos)
    .where(eq(photos.lotId, lotId))
    .orderBy(desc(photos.createdAt))
    .all()
    .filter((p) => p.contractId === null);
}

export function listPhotosForContract(contractId: string): Photo[] {
  return db.select().from(photos).where(eq(photos.contractId, contractId)).orderBy(desc(photos.createdAt)).all();
}

export function listPhotosForLot(lotId: string): Photo[] {
  return db.select().from(photos).where(eq(photos.lotId, lotId)).orderBy(desc(photos.createdAt)).all();
}

/** Read a stored photo back as a grading-request image. */
export function photoAsGradingImage(photo: Photo): GradingImage {
  const abs = path.join(config.storageDir, ...photo.path.split('/'));
  if (!fs.existsSync(abs)) throw notFound(`photo file ${photo.path}`);
  return { mime: photo.mime, base64: fs.readFileSync(abs).toString('base64') };
}
