import type { ApiConfig } from "./config";

export async function generatePresignedURL(cfg: ApiConfig, key: string, expireTime: number) {
    const url = cfg.s3Client.presign(key, {
        bucket: cfg.s3Bucket,
        expiresIn: expireTime,
    })

    return url;
}