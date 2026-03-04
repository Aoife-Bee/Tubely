import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";


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

  const Base64Encoded = Buffer.from(fileData).toString("base64");
  const Base64DataURL = `data:${mediaType};base64,${Base64Encoded}`;


  video.thumbnailURL = Base64DataURL;
  updateVideo(cfg.db, video);


  return respondWithJSON(200, video);
}
