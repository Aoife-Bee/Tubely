import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import { getInMemoryURL } from "./assets"; 
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

const videoThumbnails: Map<string, Thumbnail> = new Map();

export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  const thumbnail = videoThumbnails.get(videoId);
  if (!thumbnail) {
    throw new NotFoundError("Thumbnail not found");
  }

  return new Response(thumbnail.data, {
    headers: {
      "Content-Type": thumbnail.mediaType,
      "Cache-Control": "no-store",
    },
  });
}

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
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

  const FormData = await req.formData();
  const file = FormData.get("thumbnail");
  if (!(file instanceof File)) {
    throw new BadRequestError("No thumbnail file provided");
  }

  const MAX_UPLOAD_SIZE = 10 << 20; // 10MB

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail file exceeds the maximum allowed size of 10MB");
  }

  const mediaType = file.type;
  if (!mediaType) {
    throw new BadRequestError("Missing Content-Type for thumbnail");
  }

  const fileData = await file.arrayBuffer();
  if (!fileData) {
    throw new BadRequestError("Error reading file data");
  }

  videoThumbnails.set(videoId, {
    data: fileData,
    mediaType,
  });

  const urlPath = getInMemoryURL(cfg, videoId);
  video.thumbnailURL = urlPath;
  updateVideo(cfg.db, video);


  return respondWithJSON(200, video);
}
