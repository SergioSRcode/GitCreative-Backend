import { Client } from 'minio';

const useSSL = process.env.MINIO_USE_SSL !== 'false'; // defaults to true, override for local dev

export const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: Number(process.env.MINIO_PORT) || 9000,
  useSSL,
  accessKey: process.env.MINIO_ACCESS_KEY  || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
});

export const BUCKET = process.env.MINIO_BUCKET || 'gitcreative-snapshots';

// ensures the bucket exists on startup - creates one if missing
export async function ensureBucket() {
  if (process.env.NODE_ENV === 'production') return;  // no need to creat bucket locally, is created in prod via R2

  const exists = await minioClient.bucketExists(BUCKET);
  if (!exists) {
    await minioClient.makeBucket(BUCKET);
    console.log(`Created MinIO bucket: ${BUCKET}`);
  }
}

// uploads a binary buffer as an object and returns its key
export async function uploadSnapshot(
  projectId: string,
  commitId: string,
  data: Buffer
): Promise<string> {
  const key = `snapshots/${projectId}/${commitId}.gitcreative`;

  await minioClient.putObject(BUCKET, key, data, data.length, { 'Content-Type': 'application/octet-stream', });

  return key;
}

// downloads a snapshot by its key and returns a buffer
export async function downloadSnapshot(key: string): Promise<Buffer> {
  const stream = await minioClient.getObject(BUCKET, key);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export async function uploadSnapshotToKey(key: string, data: Buffer): Promise<string> {
  await minioClient.putObject(BUCKET, key, data, data.length, {
    'Content-Type': 'application/octet-stream',
  });

  return key;
}