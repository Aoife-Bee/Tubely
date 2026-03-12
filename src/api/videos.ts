import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import path from "path";
import { rm } from "node:fs/promises";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getAssetDiskPath, getAssetURL, getAssetPath } from "./assets";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { error } from "node:console";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const UPLOAD_LIMIT = 1 << 30; // 1 GB

  const { videoId } = req.params as { videoId?: string };

  if (!videoId) {
    throw new BadRequestError("Missing videoId parameter");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }
  if (userID !== video.userID) {
      throw new UserForbiddenError("You don't have permission to update this video");
  }

  const formData = await req.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new BadRequestError("No video file provided");
  }

  if (file.size > UPLOAD_LIMIT) {
    throw new BadRequestError("Video file exceeds the maximum allowed size of 1GB")
  }

  const mediaType = file.type;
  if (!mediaType) {
    throw new BadRequestError("Missing Content-Type for video");
  }
  if (mediaType !== "video/mp4") {
    throw new BadRequestError("Unsupported media type. Video must be an MP4");
  }

  const fileName = `${videoId}.mp4`;
  const tempFilePath = path.join("/tmp", fileName); 
  await Bun.write(tempFilePath, file);

  const aspectRatio = await getVideoAspectRatio(tempFilePath);
  const fullAssetPath = `${aspectRatio}/${fileName}`;

  const s3file = cfg.s3Client.file(fullAssetPath, {
    bucket: cfg.s3Bucket,
  });
  await s3file.write(Bun.file(tempFilePath), {
    type: mediaType,
  });


  const s3URL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${fullAssetPath}`
  video.videoURL = s3URL;
  updateVideo(cfg.db, video);

  await rm(tempFilePath);

  return respondWithJSON(200, video);
}


async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn(
    [
      "ffprobe", 
      "-v", 
      "error", 
      "-select_streams", 
      "v:0", 
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const stdoutText = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const errText = await new Response(proc.stderr).text();
    throw new Error(`ffprobe failed with exit code ${exitCode}: ${errText}`);
  }

  const data = JSON.parse(stdoutText);
  if (!data.streams || data.streams.length === 0) {
    throw new BadRequestError("No video stream found");
  }
  const { width, height } = data.streams[0]
  if (!width || !height) {
    throw new BadRequestError("Missing video dimensions");
  }

if (width === Math.floor(16 * (height / 9))) {
    return "landscape";
}
if (height === Math.floor(16 * (width / 9))) {
    return "portrait";
}
  return "other";
}