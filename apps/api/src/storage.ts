import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/** Хранилище файлов. В тестах подменяется на MemoryStorage. */
export interface FileStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(keys: string[]): Promise<void>;
  publicUrl(key: string): string;
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  publicUrl: string;
}

export class S3Storage implements FileStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async delete(keys: string[]) {
    if (keys.length === 0) return;
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.config.bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      }),
    );
  }

  publicUrl(key: string) {
    return `${this.config.publicUrl.replace(/\/$/, '')}/${key}`;
  }

  /** Dev: создаёт бакет и открывает на чтение префикс photos/. В prod бакет настраивается заранее. */
  async ensureBucket() {
    const Bucket = this.config.bucket;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket }));
      return;
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket }));
    }
    await this.client.send(
      new PutBucketPolicyCommand({
        Bucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${Bucket}/photos/*`],
            },
          ],
        }),
      }),
    );
  }
}

export class MemoryStorage implements FileStorage {
  readonly files = new Map<string, { body: Buffer; contentType: string }>();

  async put(key: string, body: Buffer, contentType: string) {
    this.files.set(key, { body, contentType });
  }

  async delete(keys: string[]) {
    for (const key of keys) this.files.delete(key);
  }

  publicUrl(key: string) {
    return `/media/${key}`;
  }
}
