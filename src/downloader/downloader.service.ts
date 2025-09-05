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
import { DownloadsStatsService } from '../downloads-stats/downloads-stats.service.js';
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
    private downloadsStatsService: DownloadsStatsService,
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

    console.log('usersQuery', usersQuery);

    const queriesEntities = [...usersQuery.users, ...usersQuery.chats];

    if (queriesEntities.length === 0) {
      await this.invalidUsernames.create({
        username,
        lastChecked: new Date(),
      });
      throw new Error('USERNAME_NOT_OCCUPIED', {
        cause: 'No users with this username found',
      });
    }

    for (const user of queriesEntities) {
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

  private async getPinnedStories(
    tg: TelegramClient,
    inputPeer: tl.RawInputPeerUser | tl.RawInputPeerChannel,
    limit: number = 10,
  ) {
    const pinnedStories = await tg.call({
      _: 'stories.getPinnedStories',
      peer: inputPeer,
      offsetId: 0,
      limit: limit,
    });
    return pinnedStories.stories;
  }

  private async getStoriesByIds(
    tg: TelegramClient,
    inputPeer: tl.RawInputPeerUser | tl.RawInputPeerChannel,
    storyIds: string[],
  ) {
    const story = await tg.call({
      _: 'stories.getStoriesByID',
      id: storyIds.map((id) => parseInt(id)),
      peer: inputPeer,
    });
    return story.stories;
  }

  private async getPeerStories(
    tg: TelegramClient,
    inputPeer: tl.RawInputPeerUser | tl.RawInputPeerChannel,
  ) {
    const story = await tg.call({
      _: 'stories.getPeerStories',
      peer: inputPeer,
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

  /**
   * Benchmarks different download methods to compare their performance
   *
   * This method tests all available download methods from @mtcute/node:
   * - downloadToFile: Direct file download (most straightforward)
   * - downloadAsNodeStream: Returns a Node.js readable stream
   * - downloadAsIterable: Returns an async iterable of chunks
   * - downloadAsStream: Returns an async iterable stream
   * - downloadAsBuffer: Downloads entire file into memory as Buffer
   *
   * The benchmark runs each method sequentially and reports:
   * - Execution time in milliseconds
   * - File size for verification
   * - Success/failure status
   * - Ranking from fastest to slowest
   *
   * @param tg - Telegram client instance
   * @param fileId - File ID to download
   * @param baseFilePath - Base file path for test files (without extension)
   */
  private async benchmarkDownloadMethods(
    tg: TelegramClient,
    fileId: string,
    baseFilePath: string,
  ): Promise<void> {
    console.log('\n=== Starting Download Methods Benchmark ===');
    console.log(`File ID: ${fileId}`);

    const methods = [
      'downloadToFile',
      'downloadAsNodeStream',
      'downloadAsIterable',
      'downloadAsStream',
      'downloadAsBuffer',
    ];

    const results: {
      method: string;
      time: number;
      success: boolean;
      error?: string;
    }[] = [];

    for (const method of methods) {
      const testFilePath = `${baseFilePath}_test_${method}`;
      let startTime: number = 0;
      let endTime: number;
      let success = false;
      let error: string | undefined;

      try {
        console.log(`\nTesting ${method}...`);
        startTime = Date.now();

        switch (method) {
          case 'downloadToFile':
            await tg.downloadToFile(testFilePath, fileId);
            success = true;
            break;

          case 'downloadAsNodeStream':
            const nodeStream = tg.downloadAsNodeStream(fileId);
            const writeStream = fs.createWriteStream(testFilePath);
            await new Promise<void>((resolve, reject) => {
              nodeStream.pipe(writeStream);
              nodeStream.on('end', resolve);
              nodeStream.on('error', reject);
              writeStream.on('error', reject);
            });
            success = true;
            break;

          case 'downloadAsIterable':
            const iterable = tg.downloadAsIterable(fileId);
            await fs.promises.writeFile(testFilePath, ''); // Create empty file
            for await (const chunk of iterable) {
              await fs.promises.appendFile(testFilePath, chunk);
            }
            success = true;
            break;

          case 'downloadAsStream':
            const stream = tg.downloadAsStream(fileId);
            await fs.promises.writeFile(testFilePath, ''); // Create empty file
            for await (const chunk of stream) {
              await fs.promises.appendFile(testFilePath, chunk);
            }
            success = true;
            break;

          case 'downloadAsBuffer':
            const buffer = await tg.downloadAsBuffer(fileId);
            await fs.promises.writeFile(testFilePath, buffer);
            success = true;
            break;
        }

        endTime = Date.now();
        const duration = endTime - startTime;

        results.push({
          method,
          time: duration,
          success,
        });

        // Get file size for context
        const stats = fs.existsSync(testFilePath)
          ? fs.statSync(testFilePath)
          : null;
        const fileSize = stats ? stats.size : 0;
        console.log(`${method}: ${duration}ms ✓ (${fileSize} bytes)`);
      } catch (err) {
        endTime = Date.now();
        const duration = endTime - startTime;
        error = err instanceof Error ? err.message : String(err);

        results.push({
          method,
          time: duration,
          success: false,
          error,
        });

        console.log(`${method}: ${duration}ms ✗ (${error})`);
      }

      // Clean up test file
      try {
        if (fs.existsSync(testFilePath)) {
          await fs.promises.unlink(testFilePath);
        }
      } catch (cleanupError) {
        console.warn(`Failed to cleanup ${testFilePath}:`, cleanupError);
      }
    }

    // Display benchmark results
    console.log('\n=== Benchmark Results ===');
    const successfulResults = results.filter((r) => r.success);

    if (successfulResults.length > 0) {
      // Sort by time (fastest first)
      successfulResults.sort((a, b) => a.time - b.time);

      console.log('Successful downloads (fastest to slowest):');
      successfulResults.forEach((result, index) => {
        const rank = index + 1;
        const speedDiff =
          index === 0 ? '' : ` (+${result.time - successfulResults[0].time}ms)`;
        console.log(`${rank}. ${result.method}: ${result.time}ms${speedDiff}`);
      });

      const fastest = successfulResults[0];
      const slowest = successfulResults[successfulResults.length - 1];
      const speedImprovement = (
        ((slowest.time - fastest.time) / slowest.time) *
        100
      ).toFixed(1);

      console.log(
        `\nFastest method: ${fastest.method} (${speedImprovement}% faster than slowest)`,
      );
    }

    const failedResults = results.filter((r) => !r.success);
    if (failedResults.length > 0) {
      console.log('\nFailed downloads:');
      failedResults.forEach((result) => {
        console.log(`- ${result.method}: ${result.error}`);
      });
    }

    console.log('=== End Benchmark ===\n');
  }

  async getStoryByUsername(
    username: string,
    archive: boolean = false,
    archiveLimit: number = 10,
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
            base_url: process.env.NODE_API_URL?.replace(/\/$/, ''),
          };
        }
      } catch (error) {
        console.warn('Cache lookup failed:', error);
        // Continue with normal flow if cache fails
      }
    }

    const {
      account: tg,
      mutex,
      accountData,
    } = await this.telestoryAccountsService.getNextAccount();

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
            10,
          );
        }

        console.log('Resolved peer', resolvedPeer);

        if (
          resolvedPeer.status === undefined &&
          (resolvedPeer._ as any) != 'channel'
        ) {
          console.log('Account is banned by user');

          // Record the ban information
          const bannedByPhone = username.match(/^\d+$/) ? username : undefined;
          const bannedByUsername = bannedByPhone ? username : username;
          const bannedByUserId = resolvedPeer.id
            ? resolvedPeer.id.toString()
            : undefined;

          await this.telestoryAccountsService.recordAccountBan(
            (accountData._id as string).toString(),
            bannedByUsername,
            bannedByUserId,
            bannedByPhone,
          );

          throw new Error('ACCOUNT_BANNED_BY_USER');
        }

        console.log('Resolved peer', resolvedPeer);

        let stories: tl.TypeStoryItem[] = [];

        const inputPeer =
          (resolvedPeer._ as any) === 'user'
            ? {
                _: 'inputPeerUser' as 'inputPeerUser',
                userId: resolvedPeer.id,
                accessHash: resolvedPeer.accessHash!,
              }
            : ({
                _: 'inputPeerChannel' as 'inputPeerChannel',
                channelId: resolvedPeer.id,
                accessHash: resolvedPeer.accessHash!,
              } as tl.RawInputPeerUser | tl.RawInputPeerChannel);

        if (archive) {
          stories = (await this.getPinnedStories(
            tg,
            inputPeer,
            archiveLimit,
          )) as tl.TypeStoryItem[];
        } else if (storyIds.length > 0) {
          stories = (await this.getStoriesByIds(
            tg,
            inputPeer,
            storyIds,
          )) as tl.TypeStoryItem[];
        } else {
          stories = (await this.getPeerStories(
            tg,
            inputPeer,
          )) as unknown as tl.TypeStoryItem[];
        }

        console.log('Mark as read', markAsRead);

        try {
          if (markAsRead && inputPeer._ != 'inputPeerChannel') {
            if (archive) {
              const incrementStoryViews = await tg.call({
                _: 'stories.incrementStoryViews',
                id: stories.map((story) => story.id),
                peer: inputPeer,
              });
              console.log('Increment story views', incrementStoryViews);
            } else {
              await tg.call({
                _: 'stories.readStories',
                maxId: 2 ** 16 - 1,
                peer: inputPeer,
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
              base_url: process.env.NODE_API_URL?.replace(/\/$/, ''),
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
            inputPeer,
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
              url: `downloads/${fileUniqueId}/${fs.readdirSync(storyFolder)[0]}`,
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
            console.log(
              'Downloading story',
              story.content.fileId,
              storyFilePath,
            );

            // Benchmark different download methods (only if enabled)
            // await this.benchmarkDownloadMethods(
            //   tg,
            //   story.content.fileId,
            //   storyFilePath,
            // );

            // Use the fastest method (replace with actual download)
            // await tg.downloadToFile(storyFilePath, story.content.fileId);
            await tg.downloadToFile(storyFilePath, story.content.fileId);

            console.log('Downloaded story', story.content.fileId);

            // Record download statistics after successful download
            try {
              const fileStats = fs.statSync(storyFilePath);
              const fileSize = fileStats.size;
              const fileType = story.mediaType || 'unknown';

              await this.downloadsStatsService.addDownloadStats(
                process.env.NODE_ID!,
                accountData.name,
                fileSize,
                fileType,
              );

              console.log('Recorded download stats:', {
                nodeId: process.env.NODE_ID,
                account: accountData.name,
                fileSize: fileSize,
                fileType: fileType,
              });
            } catch (statsError) {
              console.warn('Failed to record download stats:', statsError);
            }
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
                base_url: process.env.NODE_API_URL?.replace(/\/$/, ''),
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
          base_url: process.env.NODE_API_URL?.replace(/\/$/, ''),
        };
      });
    } catch (error) {
      console.error(error);
      if (error && error.code == 401) {
        // Handle account died

        await this.telestoryAccountData.updateOne(
          { name: accountData.name },
          { isActive: false, inactiveReason: error.message },
        );
      }
      return {
        ok: false,
        error: error?.message || JSON.stringify(error),
        error_debug: error?.cause || JSON.stringify(error),
      };
    }
  }
}
