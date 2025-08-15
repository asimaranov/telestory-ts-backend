import { Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DownloadsCleanerService } from './downloads-cleaner.service';

@ApiTags('Downloads Cleaner')
@Controller('downloads-cleaner')
export class DownloadsCleanerController {
  constructor(private readonly downloadsCleanerService: DownloadsCleanerService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get downloads directory statistics' })
  @ApiResponse({
    status: 200,
    description: 'Returns statistics about the downloads directory',
    schema: {
      type: 'object',
      properties: {
        totalFiles: { type: 'number', description: 'Total number of files' },
        totalSize: { type: 'number', description: 'Total size in bytes' },
        totalSizeFormatted: { type: 'string', description: 'Total size in human-readable format' },
        oldestFile: { type: 'string', format: 'date-time', description: 'Date of oldest file' },
        newestFile: { type: 'string', format: 'date-time', description: 'Date of newest file' },
        diskSpace: {
          type: 'object',
          properties: {
            totalSpace: { type: 'number', description: 'Total disk space in bytes' },
            freeSpace: { type: 'number', description: 'Free disk space in bytes' },
            freeSpacePercent: { type: 'number', description: 'Free disk space percentage' },
            totalSpaceFormatted: { type: 'string', description: 'Total disk space in human-readable format' },
            freeSpaceFormatted: { type: 'string', description: 'Free disk space in human-readable format' },
          },
        },
      },
    },
  })
  async getStats() {
    const stats = await this.downloadsCleanerService.getCleanupStats();
    
    return {
      ...stats,
      totalSizeFormatted: this.formatBytes(stats.totalSize),
      diskSpace: {
        ...stats.diskSpace,
        totalSpaceFormatted: this.formatBytes(stats.diskSpace.totalSpace),
        freeSpaceFormatted: this.formatBytes(stats.diskSpace.freeSpace),
      },
    };
  }

  @Post('cleanup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger manual cleanup' })
  @ApiResponse({
    status: 200,
    description: 'Cleanup completed successfully',
    schema: {
      type: 'object',
      properties: {
        filesRemoved: { type: 'number', description: 'Number of files removed' },
        foldersRemoved: { type: 'number', description: 'Number of folders removed' },
        spaceFreed: { type: 'number', description: 'Space freed in bytes' },
        spaceFreedFormatted: { type: 'string', description: 'Space freed in human-readable format' },
        reason: { type: 'string', description: 'Reason for cleanup' },
      },
    },
  })
  async triggerCleanup() {
    const result = await this.downloadsCleanerService.performCleanup();
    
    return {
      ...result,
      spaceFreedFormatted: this.formatBytes(result.spaceFreed),
    };
  }

  /**
   * Format bytes into human-readable format
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }
}
