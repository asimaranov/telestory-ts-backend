import { Injectable, OnModuleInit } from '@nestjs/common';

import { Mutex } from 'async-mutex';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Photo, TelegramClient, Video } from '@mtcute/node';
import { TelestoryNodesService } from '../nodes/nodes.service.js';
import {
  InvalidUsernamesData,
  StoriesCacheData,
} from './schema/downloader.schema.js';
import { TelestoryAccountData } from '../accounts/schema/telestory-account.schema.js';
import { TelestoryAccountsService } from '../accounts/regular-node/telestory-accounts.service.js';
import { tl } from '@mtcute/node';
import * as path from 'path';
import * as fs from 'fs';
import * as fse from 'fs-extra';
import { randomBytes } from 'crypto';
import { PhoneUtils } from '../common/utils/phone.utils';

/**
 * File Name Guesser Implementation
 *
 * This implementation provides automatic file naming for downloaded media files.
 * It supports:
 * - Automatic extension detection based on file type and MIME type
 * - Timestamp-based naming with random IDs to prevent conflicts
 * - Directory handling for organized downloads
 * - Support for all Telegram media types
 *
 * Usage examples:
 * 1. Basic usage: generateMediaFileName('photo')
 * 2. With custom name: generateMediaFileName('video', 'my_video.mp4')
 * 3. With MIME type: generateMediaFileName('photo', undefined, 'image/png')
 * 4. Full control: generateFileName({ fileType: FileType.DOCUMENT, ... })
 */

// File type enum based on Telegram media types
export enum FileType {
  PHOTO = 'photo',
  VIDEO = 'video',
  ANIMATION = 'animation',
  VIDEO_NOTE = 'video_note',
  VOICE = 'voice',
  AUDIO = 'audio',
  DOCUMENT = 'document',
  STICKER = 'sticker',
}

// Photo types constant
export const PHOTO_TYPES = [FileType.PHOTO];

// Default download directory
export const DEFAULT_DOWNLOAD_DIR = 'downloads';

interface FileIdObject {
  file_type: FileType;
}

interface FileNameGuessOptions {
  fileName?: string;
  mediaFileName?: string;
  mimeType?: string;
  fileType: FileType;
  fileIdObj: FileIdObject;
  date?: Date;
}

@Injectable()
export class DownloaderService implements OnModuleInit {
  initialized = false;
  private readonly WORKDIR = process.cwd();

  constructor(
    private telestoryNodesService: TelestoryNodesService,
    @InjectModel(TelestoryAccountData.name)
    private telestoryAccountData: Model<TelestoryAccountData>,
    private telestoryAccountsService: TelestoryAccountsService,
    @InjectModel(InvalidUsernamesData.name)
    private invalidUsernames: Model<InvalidUsernamesData>,
    @InjectModel(StoriesCacheData.name)
    private storiesCache: Model<StoriesCacheData>,
  ) {}

  async onModuleInit() {
    await this.initialize();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Clean up expired cache entries on startup
    await this.cleanupExpiredCache();

    this.initialized = true;
  }

  /**
   * Manual cleanup method for expired cache entries
   * MongoDB TTL index should handle this automatically, but this provides a fallback
   */
  async cleanupExpiredCache(): Promise<void> {
    try {
      const result = await this.storiesCache.deleteMany({
        expiresAt: { $lt: new Date() },
      });
      if (result.deletedCount > 0) {
        console.log(`Cleaned up ${result.deletedCount} expired cache entries`);
      }
    } catch (error) {
      console.warn('Failed to cleanup expired cache entries:', error);
    }
  }

  /**
   * Generates a random ID for file naming
   */
  private rndId(): string {
    return randomBytes(4).toString('hex');
  }

  /**
   * Generates a cache key for stories based on username and request parameters
   */
  private generateCacheKey(
    username: string,
    archive: boolean,
    storyIds: string[],
  ): string {
    const params = {
      username: username.toLowerCase(),
      archive,
      storyIds: storyIds.sort(),
    };
    return `stories_${Buffer.from(JSON.stringify(params)).toString('base64')}`;
  }

  /**
   * Guesses file extension based on MIME type
   */
  private guessExtension(mimeType?: string): string | null {
    if (!mimeType) return null;

    const mimeToExtension: Record<string, string> = {
      // Images
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/bmp': '.bmp',
      'image/tiff': '.tiff',
      'image/svg+xml': '.svg',

      // Videos
      'video/mp4': '.mp4',
      'video/avi': '.avi',
      'video/mov': '.mov',
      'video/wmv': '.wmv',
      'video/flv': '.flv',
      'video/webm': '.webm',
      'video/mkv': '.mkv',
      'video/3gp': '.3gp',

      // Audio
      'audio/mpeg': '.mp3',
      'audio/mp3': '.mp3',
      'audio/wav': '.wav',
      'audio/flac': '.flac',
      'audio/aac': '.aac',
      'audio/ogg': '.ogg',
      'audio/opus': '.opus',
      'audio/m4a': '.m4a',

      // Documents
      'application/pdf': '.pdf',
      'application/zip': '.zip',
      'application/x-rar-compressed': '.rar',
      'application/x-7z-compressed': '.7z',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        '.docx',
      'application/vnd.ms-excel': '.xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        '.xlsx',
      'application/vnd.ms-powerpoint': '.ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        '.pptx',
      'text/plain': '.txt',
      'application/json': '.json',
      'application/xml': '.xml',
      'text/html': '.html',
      'text/css': '.css',
      'application/javascript': '.js',
      'application/typescript': '.ts',
    };

    return mimeToExtension[mimeType.toLowerCase()] || null;
  }

  /**
   * Generates a filename based on file type, MIME type, and other parameters
   */
  generateFileName(options: FileNameGuessOptions): string {
    const { fileName, mediaFileName, mimeType, fileType, fileIdObj, date } =
      options;

    // If no filename provided, generate one
    if (!fileName) {
      const guessedExtension = this.guessExtension(mimeType);
      let extension: string;

      // Determine extension based on file type
      if (PHOTO_TYPES.includes(fileType)) {
        extension = '.jpg';
      } else if (fileType === FileType.VOICE) {
        extension = guessedExtension || '.ogg';
      } else if (
        [FileType.VIDEO, FileType.ANIMATION, FileType.VIDEO_NOTE].includes(
          fileType,
        )
      ) {
        extension = guessedExtension || '.mp4';
      } else if (fileType === FileType.DOCUMENT) {
        extension = guessedExtension || '.zip';
      } else if (fileType === FileType.STICKER) {
        extension = guessedExtension || '.webp';
      } else if (fileType === FileType.AUDIO) {
        extension = guessedExtension || '.mp3';
      } else {
        extension = '.unknown';
      }

      // Generate filename with timestamp and random ID
      const timestamp = (date || new Date())
        .toISOString()
        .slice(0, 19)
        .replace(/:/g, '-')
        .replace('T', '_');

      return `${fileType}_${timestamp}_${this.rndId()}${extension}`;
    }
    return fileName;
  }

  /**
   * Convenience method to generate a filename for media downloads
   * @param mediaType - 'photo' or 'video'
   * @param customFileName - Optional custom filename
   * @param mimeType - Optional MIME type for extension guessing
   * @param date - Optional date for timestamp (defaults to now)
   * @returns Generated file path
   */
  generateMediaFileName(
    mediaType: 'photo' | 'video',
    customFileName?: string,
    mimeType?: string,
    date?: Date,
  ): string {
    const fileType = mediaType === 'photo' ? FileType.PHOTO : FileType.VIDEO;

    return this.generateFileName({
      fileName: customFileName,
      fileType,
      fileIdObj: { file_type: fileType },
      mimeType,
      date,
    });
  }

  private async resolvePeerByPhone(tg: TelegramClient, username: string) {
    const contacts = await tg.importContacts([
      {
        phone: `+${username}`,
        firstName: username,
        lastName: username,
      },
    ]);
    if (contacts.users.length === 0) {
      throw new Error('Invalid phone number');
    }
    const user = contacts.users[0] as tl.RawUser;

    return user;
  }

  private async resolvePeerByUsername(
    tg: TelegramClient,
    username: string,
    limit: number = 10,
  ) {
    const preparedUsername = username.replace(/^[@#]/, '');
    const usersQuery = await tg.call({
      _: 'contacts.search',
      q: preparedUsername,
      limit,
    });

    if (usersQuery.users.length === 0) {
      await this.invalidUsernames.create({
        username,
        lastChecked: new Date(),
      });
      throw new Error('USERNAME_NOT_OCCUPIED', {
        cause: 'No users with this username found',
      });
    }

    for (const user of usersQuery.users) {
      const userData = user as tl.RawUser;

      if (userData.username) {
        if (
          userData.username.toLowerCase() === preparedUsername.toLowerCase()
        ) {
          return userData;
        }
      }

      if (userData.usernames) {
        for (const username of userData.usernames) {
          if (
            username.username.toLowerCase() === preparedUsername.toLowerCase()
          ) {
            return userData;
          }
        }
      }
    }
    await this.invalidUsernames.create({
      username,
      lastChecked: new Date(),
    });
    throw new Error('USERNAME_NOT_OCCUPIED', {
      cause: 'Queried users username not matched',
    });
  }

  private async getPinnedStories(tg: TelegramClient, peer: tl.RawUser) {
    const pinnedStories = await tg.call({
      _: 'stories.getPinnedStories',
      peer: {
        _: 'inputPeerUser',
        userId: peer.id,
        accessHash: peer.accessHash!,
      },
      offsetId: 0,
      limit: 10,
    });
    return pinnedStories.stories;
  }

  private async getStoriesByIds(
    tg: TelegramClient,
    peer: tl.RawUser,
    storyIds: string[],
  ) {
    const story = await tg.call({
      _: 'stories.getStoriesByID',
      id: storyIds.map((id) => parseInt(id)),
      peer: {
        _: 'inputPeerUser',
        userId: peer.id,
        accessHash: peer.accessHash!,
      },
    });
    return story.stories;
  }

  private async getPeerStories(tg: TelegramClient, peer: tl.RawUser) {
    const story = await tg.call({
      _: 'stories.getPeerStories',
      peer: {
        _: 'inputPeerUser',
        userId: peer.id,
        accessHash: peer.accessHash!,
      },
    });
    return story.stories.stories;
  }

  async parseStories(tg: TelegramClient, stories: tl.RawStoryItem[]) {
    const storiesData: {
      mediaType: string;
      content: Photo | Video;
      meta: {
        public: boolean;
        close_friends: boolean;
        noforwards: boolean;
        edited: boolean;
        date: number;
        expire_date: number;
        caption: string;
        pinned: boolean;
      };
      id: number;
    }[] = [];

    for (const story of stories) {
      const media = story.media;

      const meta = {
        public: story.public || false,
        close_friends: story.closeFriends || false,
        noforwards: story.noforwards || false,
        edited: story.edited || false,
        date: story.date,
        expire_date: story.expireDate,
        caption: story.caption || '',
        pinned: story.pinned || false,
      };

      if (media._ === 'messageMediaPhoto') {
        const photo = media as tl.RawMessageMediaPhoto;
        storiesData.push({
          mediaType: 'photo',
          content: new Photo(photo.photo as tl.RawPhoto, media),
          meta,
          id: story.id,
        });
      } else if (media._ === 'messageMediaDocument') {
        const document = media.document as tl.RawDocument;

        const attributes = document.attributes;

        if (
          attributes.find(
            (attribute) => attribute._ === 'documentAttributeVideo',
          )
        ) {
          const videoAttribute = attributes.find(
            (attribute) => attribute._ === 'documentAttributeVideo',
          ) as tl.RawDocumentAttributeVideo;
          storiesData.push({
            mediaType: 'video',
            content: new Video(document, videoAttribute, media),
            meta: meta,
            id: story.id,
          });
        }
      }
    }

    return storiesData;
  }

  async getStoryByUsername(
    username: string,
    archive: boolean = false,
    markAsRead: boolean = false,
    storyIds: string[] = [],
    premium: boolean = false,
  ) {
    // Check cache for non-premium users (skip cache for premium users and markAsRead requests)

    const cacheKey = this.generateCacheKey(username, archive, storyIds);

    if (!premium && !markAsRead) {
      try {
        const cachedData = await this.storiesCache.findOne({
          cacheKey,
          expiresAt: { $gt: new Date() },
        });

        if (cachedData) {
          console.log('Returning cached stories for username:', username);
          return {
            ok: true,
            username: username,
            stories: cachedData.storiesData,
            never_created: cachedData.neverCreated,
          };
        }
      } catch (error) {
        console.warn('Cache lookup failed:', error);
        // Continue with normal flow if cache fails
      }
    }

    const { account: tg, mutex } =
      await this.telestoryAccountsService.getNextAccount();

    try {
      return await mutex.runExclusive(async () => {
        let resolvedPeer: tl.RawUser | null = null;

        if (username.match(/^\d+$/)) {
          resolvedPeer = await this.resolvePeerByPhone(tg, username);
        } else {
          const invalidUsernameCache = await this.invalidUsernames.findOne({
            username,
          });
          // if last checked is less than 48 hours ago, throw error
          if (
            invalidUsernameCache &&
            invalidUsernameCache.lastChecked.getTime() + 1000 * 60 * 60 * 48 >
              Date.now()
          ) {
            throw new Error('USERNAME_NOT_OCCUPIED', {
              cause: 'Cached username not occupied',
            });
          }
          resolvedPeer = await this.resolvePeerByUsername(
            tg,
            username,
            premium ? 25 : 10,
          );
        }

        if (resolvedPeer.status === undefined) {
          console.log('Account is banned by user');
          throw new Error('ACCOUNT_BANNED_BY_USER');
        }

        console.log('Resolved peer', resolvedPeer);

        let stories: tl.TypeStoryItem[] = [];

        if (archive) {
          stories = (await this.getPinnedStories(
            tg,
            resolvedPeer,
          )) as tl.TypeStoryItem[];
        } else if (storyIds.length > 0) {
          stories = (await this.getStoriesByIds(
            tg,
            resolvedPeer,
            storyIds,
          )) as tl.TypeStoryItem[];
        } else {
          stories = (await this.getPeerStories(
            tg,
            resolvedPeer,
          )) as unknown as tl.TypeStoryItem[];
        }

        console.log('Mark as read', markAsRead);

        try {
          if (markAsRead) {
            if (archive) {
              const incrementStoryViews = await tg.call({
                _: 'stories.incrementStoryViews',
                id: stories.map((story) => story.id),
                peer: {
                  _: 'inputPeerUser',
                  userId: resolvedPeer.id,
                  accessHash: resolvedPeer.accessHash!,
                },
              });
              console.log('Increment story views', incrementStoryViews);
            } else {
              await tg.call({
                _: 'stories.readStories',
                maxId: 2 ** 16 - 1,
                peer: {
                  _: 'inputPeerUser',
                  userId: resolvedPeer.id,
                  accessHash: resolvedPeer.accessHash!,
                },
              });
            }
          }
        } catch (error) {
          console.error('Error marking stories as read:', error);
          if (error?.message === 'STORIES_NEVER_CREATED') {
            // Save to cache with 10-minute expiration
            await this.storiesCache.findOneAndUpdate(
              { cacheKey },
              {
                username: username.toLowerCase(),
                storiesData: [],
                expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes from now
                cacheKey,
                neverCreated: true,
              },
              { upsert: true, new: true },
            );

            return {
              ok: true,
              username: username,
              stories: [],
              never_created: true,
            };
          }
        }

        const skippedStories = stories.filter(
          (story) => story._ === 'storyItemSkipped',
        );

        console.log('Resolving skipped stories', skippedStories);

        let resolvedSkippedStories: tl.TypeStoryItem[] = [];

        if (skippedStories.length > 0) {
          resolvedSkippedStories = await this.getStoriesByIds(
            tg,
            resolvedPeer,
            skippedStories.map((story) => story.id.toString()),
          );
        }

        const preparedStories: tl.RawStoryItem[] = [
          ...stories.filter((story) => story._ === 'storyItem'),
          ...resolvedSkippedStories.filter((story) => story._ === 'storyItem'),
        ] as tl.RawStoryItem[];
        stories = preparedStories;

        const parsedStories = await this.parseStories(tg, preparedStories);

        console.log('Parsed stories', JSON.stringify(parsedStories, null, 2));

        const media: any[] = [];

        for (const story of parsedStories) {
          const fileUniqueId = story.content.uniqueFileId;
          const storyFolder = path.join(
            process.cwd(),
            'downloads',
            fileUniqueId,
          );

          // Ensure the story folder exists
          await fse.ensureDir(storyFolder);
          // is not empty directory
          if (
            fs.existsSync(storyFolder) &&
            fs.readdirSync(storyFolder).length > 0
          ) {
            media.push({
              url: `static/${fileUniqueId}/${fs.readdirSync(storyFolder)[0]}`,
              ...story.meta,
              skipped: story.id in skippedStories.map((story) => story.id),
            });

            console.log('File found');

            continue;
          }

          // Example of using the file name guesser:
          const generatedFileName = this.generateMediaFileName(
            story.mediaType as 'photo' | 'video',
            (story.content as Video).fileName || undefined, // No custom filename
            undefined, // mimeType can be added if available from Telegram API
            new Date(story.meta.date * 1000), // Convert Unix timestamp to Date
          );

          console.log('Generated filename:', generatedFileName);

          const storyFilePath = path.join(storyFolder, generatedFileName);
          console.log('Log 1:', storyFilePath);

          try {
            console.log('Downloading story', story.content.fileId, storyFilePath);

            await tg.downloadToFile(storyFilePath, story.content.fileId);
          } catch (error) {
            console.log('Failed to download story', error);
          }
          console.log('Log 2:', storyFilePath);

          // const metaFilePath = path.join(process.cwd(), 'stories', fileUniqueId, 'meta.json');

          // if (fs.existsSync(metaFilePath)) {
          //   continue;
          // } else {
          // await tg.downloadToFile(story.content.fileId, generatedFileName);

          // await fs.promises.writeFile(metaFilePath, JSON.stringify(story, null, 2));

          media.push({
            url: `downloads/${fileUniqueId}/${generatedFileName}`,
            // id: story.id,
            ...story.meta,
            skipped: story.id in skippedStories.map((story) => story.id),
          });
          console.log('Log 3:', storyFilePath);
        }

        console.log('Media', media);

        // Cache the results for non-premium users (skip cache for premium users and markAsRead requests)
        if (!premium && !markAsRead && media.length > 0) {
          console.log('Caching stories for username:', username);
          try {
            // Save to cache with 10-minute expiration
            await this.storiesCache.findOneAndUpdate(
              { cacheKey },
              {
                username: username.toLowerCase(),
                storiesData: media,
                expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes from now
                cacheKey,
                never_created: false,
              },
              { upsert: true, new: true },
            );
            console.log('Cached stories for username:', username);
          } catch (error) {
            console.warn('Cache storage failed:', error);
            // Continue with normal flow if cache fails
          }
        }

        return {
          ok: true,
          username: username,
          stories: media,
          never_created: false,
        };
      });
    } catch (error) {
      console.error(error);
      return {
        ok: false,
        error: error?.message || JSON.stringify(error),
        error_debug: error?.cause || JSON.stringify(error),
      };
    }
  }
}
