import axios from 'axios';
import { Entity } from '../core/entity';
import { MediaEntityOembedResponse } from '../responses';

export class MediaEntity extends Entity {
  static async oembed(url: string): Promise<MediaEntityOembedResponse> {
    const { data } = await axios.get<MediaEntityOembedResponse>('https://api.instagram.com/instagram_oembed/', {
      params: { url },
    });
    return data;
  }
}
