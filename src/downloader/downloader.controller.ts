import { Controller, Body, Post } from '@nestjs/common';
import { DownloaderService } from './downloader.service';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiProperty,
} from '@nestjs/swagger';

export class GetStoriesByUsernameDto {
  @ApiProperty({
    description: 'The username of the account',
    example: '@asimaranov',
  })
  username: string;

  @ApiProperty({
    description: 'Whether to archive the stories',
    example: true,
    default: false,
    required: false,
  })
  archive?: boolean;

  @ApiProperty({
    description: 'Whether to mark the stories as read',
    example: true,
    default: false,
    required: false,
  })
  markAsRead?: boolean;

  @ApiProperty({
    description: 'The story ids to get',
    example: '1,2,3',
    default: '',
    required: false,
  })
  storyIds?: string;
}

@ApiTags('downloader')
@Controller('downloader')
export class DownloaderController {
  constructor(private readonly downloaderService: DownloaderService) {}

  @Post('getStoriesByUsername')
  @ApiOperation({ summary: 'Get stories by username' })
  @ApiBody({ type: GetStoriesByUsernameDto })
  @ApiResponse({ status: 201, description: 'Account successfully created' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async getStoriesByUsername(@Body() body: GetStoriesByUsernameDto) {
    const archive = body.archive ?? false;
    const markAsRead = body.markAsRead ?? false;
    const storyIds = body.storyIds
      ? body.storyIds.split(',').map((id) => id.trim())
      : [];

    const stories = await this.downloaderService.getStoryByUsername(
      body.username,
      archive,
      markAsRead,
      storyIds,
    );
    console.log('stories data', stories);
    return stories;
  }
}
