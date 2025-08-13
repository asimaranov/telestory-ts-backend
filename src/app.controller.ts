import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { DownloaderService } from './downloader/downloader.service';

export class GetStoriesByUsernameQueryDto {
  api_key: string;
  username: string;
  archive?: string;
  mark?: string;
  premium?: string;
  story_ids?: string;
}

@ApiTags('app')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly downloaderService: DownloaderService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('get_stories_by_username')
  @ApiOperation({ 
    summary: 'Get stories by username',
    description: 'Retrieves stories for a given username with optional parameters for archive, marking as read, and premium features'
  })
  @ApiQuery({ name: 'api_key', description: 'API key for authentication', required: true })
  @ApiQuery({ name: 'username', description: 'Username to get stories for', required: true })
  @ApiQuery({ name: 'archive', description: 'Whether to get archived/pinned stories', required: false })
  @ApiQuery({ name: 'mark', description: 'Whether to mark stories as read', required: false })
  @ApiQuery({ name: 'premium', description: 'Whether to use premium features', required: false })
  @ApiQuery({ name: 'story_ids', description: 'Story IDs to get', required: false })
  @ApiResponse({ status: 200, description: 'Stories retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async getStoriesByUsername(@Query() query: GetStoriesByUsernameQueryDto) {
    // Convert string parameters to boolean
    const archive = query.archive === 'true';
    const markAsRead = query.mark === 'true';
    const premium = query.premium === 'true';

    // For now, we'll just validate that api_key is provided
    // You can add proper API key validation logic here
    if (!query.api_key) {
      throw new Error('API key is required');
    }

    if (query.api_key !== process.env.API_KEY || 'aEcYuKX62u8N') {
      throw new Error('Invalid API key');
    }

    if (!query.username) {
      throw new Error('Username is required');
    }

    const storyIds = query.story_ids
      ? query.story_ids.split(',').map((id) => id.trim())
      : [];

    const stories = await this.downloaderService.getStoryByUsername(
      query.username,
      archive,
      markAsRead,
      storyIds,
      premium,
    );

    return stories;
  }
}
