import { UploadVideoOptions } from './upload.video.options';
import { MediaConfigureToIgtvOptions } from './media.configure-to-igtv.options';

export interface PostingIgtvOptions {
  // additional options for further configuration
  uploadOptions?: Partial<UploadVideoOptions>;
  configureOptions?: Partial<MediaConfigureToIgtvOptions>;

  video: Buffer;
  coverFrame: Buffer;

  title: string;
  caption?: string;
  audioMuted?: boolean;

  shareToFeed?: boolean;
  feedPreviewCrop?: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
}
