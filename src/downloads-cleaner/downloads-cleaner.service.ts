import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import * as fse from 'fs-extra';

interface CleanupConfig {
  maxAgeHours: number;
  diskSpaceThresholdPercent: number;
  downloadsPath: string;
}

interface FileInfo {
  path: string;
  size: number;
  createdAt: Date;
  directory: string;
}

@Injectable()
export class DownloadsCleanerService implements OnModuleInit {
  private readonly logger = new Logger(DownloadsCleanerService.name);
  private readonly config: CleanupConfig;

  constructor() {
    this.config = {
      maxAgeHours: parseInt(process.env.CLEANUP_MAX_AGE_HOURS || '24', 10),
      diskSpaceThresholdPercent: parseInt(process.env.CLEANUP_DISK_THRESHOLD_PERCENT || '10', 10),
      downloadsPath: path.join(process.cwd(), 'downloads'),
    };
  }

  async onModuleInit() {
    this.logger.log('Downloads Cleaner Service initialized');
    this.logger.log(`Configuration: Max age: ${this.config.maxAgeHours}h, Disk threshold: ${this.config.diskSpaceThresholdPercent}%`);
    
    // Run initial cleanup
    await this.performCleanup();
  }

  /**
   * Scheduled cleanup job - runs every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduledCleanup() {
    this.logger.log('Running scheduled cleanup...');
    await this.performCleanup();
  }

  /**
   * Manual cleanup method that can be called externally
   */
  async performCleanup(): Promise<{
    filesRemoved: number;
    foldersRemoved: number;
    spaceFreed: number;
    reason: string;
  }> {
    try {
      const downloadsDirExists = await fse.pathExists(this.config.downloadsPath);
      if (!downloadsDirExists) {
        this.logger.log('Downloads directory does not exist, skipping cleanup');
        return { filesRemoved: 0, foldersRemoved: 0, spaceFreed: 0, reason: 'Downloads directory does not exist' };
      }

      // Get disk space information
      const diskSpace = await this.getDiskSpaceInfo();
      const shouldCleanupByAge = true; // Always check age-based cleanup
      const shouldCleanupBySpace = diskSpace.freeSpacePercent < this.config.diskSpaceThresholdPercent;

      let reason = '';
      if (shouldCleanupByAge && shouldCleanupBySpace) {
        reason = `Age-based cleanup (${this.config.maxAgeHours}h) and low disk space (${diskSpace.freeSpacePercent.toFixed(1)}% free)`;
      } else if (shouldCleanupByAge) {
        reason = `Age-based cleanup (${this.config.maxAgeHours}h)`;
      } else if (shouldCleanupBySpace) {
        reason = `Low disk space (${diskSpace.freeSpacePercent.toFixed(1)}% free)`;
      } else {
        this.logger.log(`No cleanup needed. Disk space: ${diskSpace.freeSpacePercent.toFixed(1)}% free`);
        return { filesRemoved: 0, foldersRemoved: 0, spaceFreed: 0, reason: 'No cleanup needed' };
      }

      this.logger.log(`Starting cleanup - ${reason}`);

      // Get all files in downloads directory
      const allFiles = await this.getAllFilesRecursively(this.config.downloadsPath);
      
      if (allFiles.length === 0) {
        this.logger.log('No files found in downloads directory');
        return { filesRemoved: 0, foldersRemoved: 0, spaceFreed: 0, reason: 'No files found' };
      }

      // Determine files to clean up
      let filesToCleanup: FileInfo[] = [];

      if (shouldCleanupByAge) {
        const expiredFiles = this.getExpiredFiles(allFiles);
        filesToCleanup = [...filesToCleanup, ...expiredFiles];
      }

      if (shouldCleanupBySpace && filesToCleanup.length === 0) {
        // If we need space but no files are expired, remove oldest files
        const sortedFiles = allFiles.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const targetSpaceToFree = this.calculateSpaceNeeded(diskSpace);
        filesToCleanup = this.selectFilesToFreeSpace(sortedFiles, targetSpaceToFree);
      }

      // Remove duplicates based on file path
      filesToCleanup = filesToCleanup.filter((file, index, array) => 
        array.findIndex(f => f.path === file.path) === index
      );

      if (filesToCleanup.length === 0) {
        this.logger.log('No files to cleanup');
        return { filesRemoved: 0, foldersRemoved: 0, spaceFreed: 0, reason: 'No files to cleanup' };
      }

      // Perform cleanup
      const result = await this.cleanupFiles(filesToCleanup);
      
      this.logger.log(`Cleanup completed: ${result.filesRemoved} files, ${result.foldersRemoved} folders, ${this.formatBytes(result.spaceFreed)} freed`);
      
      return { ...result, reason };
    } catch (error) {
      this.logger.error('Error during cleanup:', error);
      throw error;
    }
  }

  /**
   * Get disk space information
   */
  private async getDiskSpaceInfo(): Promise<{
    totalSpace: number;
    freeSpace: number;
    freeSpacePercent: number;
  }> {
    try {
      const stats = await fse.stat(this.config.downloadsPath);
      const { spawn } = require('child_process');
      
      return new Promise((resolve, reject) => {
        const df = spawn('df', [this.config.downloadsPath]);
        let output = '';
        
        df.stdout.on('data', (data: Buffer) => {
          output += data.toString();
        });
        
        df.on('close', (code: number) => {
          if (code !== 0) {
            reject(new Error(`df command failed with code ${code}`));
            return;
          }
          
          const lines = output.trim().split('\n');
          const dataLine = lines[lines.length - 1]; // Last line contains the data
          const parts = dataLine.split(/\s+/);
          
          // df output format: Filesystem 1K-blocks Used Available Use% Mounted-on
          const totalSpace = parseInt(parts[1]) * 1024; // Convert from KB to bytes
          const freeSpace = parseInt(parts[3]) * 1024; // Convert from KB to bytes
          const freeSpacePercent = (freeSpace / totalSpace) * 100;
          
          resolve({
            totalSpace,
            freeSpace,
            freeSpacePercent,
          });
        });
        
        df.on('error', (error: Error) => {
          reject(error);
        });
      });
    } catch (error) {
      this.logger.warn('Could not get disk space info, using fallback');
      // Fallback: assume we have enough space
      return {
        totalSpace: 1000000000000, // 1TB
        freeSpace: 500000000000, // 500GB
        freeSpacePercent: 50,
      };
    }
  }

  /**
   * Get all files recursively from downloads directory
   */
  private async getAllFilesRecursively(dirPath: string): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    
    try {
      const entries = await fse.readdir(dirPath);
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        const stat = await fse.stat(fullPath);
        
        if (stat.isDirectory()) {
          const subFiles = await this.getAllFilesRecursively(fullPath);
          files.push(...subFiles);
        } else if (stat.isFile()) {
          files.push({
            path: fullPath,
            size: stat.size,
            createdAt: stat.birthtime || stat.mtime, // Use birthtime if available, fallback to mtime
            directory: path.dirname(fullPath),
          });
        }
      }
    } catch (error) {
      this.logger.warn(`Could not read directory ${dirPath}:`, error);
    }
    
    return files;
  }

  /**
   * Get files that are older than the maximum age
   */
  private getExpiredFiles(files: FileInfo[]): FileInfo[] {
    const maxAgeMs = this.config.maxAgeHours * 60 * 60 * 1000;
    const cutoffTime = new Date(Date.now() - maxAgeMs);
    
    return files.filter(file => file.createdAt < cutoffTime);
  }

  /**
   * Calculate how much space we need to free up
   */
  private calculateSpaceNeeded(diskSpace: { totalSpace: number; freeSpace: number; freeSpacePercent: number }): number {
    const targetFreePercent = this.config.diskSpaceThresholdPercent + 5; // Free up 5% more than threshold
    const targetFreeSpace = (diskSpace.totalSpace * targetFreePercent) / 100;
    const spaceNeeded = Math.max(0, targetFreeSpace - diskSpace.freeSpace);
    
    return spaceNeeded;
  }

  /**
   * Select files to delete to free up the required space
   */
  private selectFilesToFreeSpace(sortedFiles: FileInfo[], targetSpace: number): FileInfo[] {
    const filesToDelete: FileInfo[] = [];
    let totalSpaceSelected = 0;
    
    for (const file of sortedFiles) {
      filesToDelete.push(file);
      totalSpaceSelected += file.size;
      
      if (totalSpaceSelected >= targetSpace) {
        break;
      }
    }
    
    return filesToDelete;
  }

  /**
   * Perform the actual file cleanup
   */
  private async cleanupFiles(files: FileInfo[]): Promise<{
    filesRemoved: number;
    foldersRemoved: number;
    spaceFreed: number;
  }> {
    let filesRemoved = 0;
    let spaceFreed = 0;
    const foldersToCheck = new Set<string>();
    
    // Remove files
    for (const file of files) {
      try {
        await fse.remove(file.path);
        filesRemoved++;
        spaceFreed += file.size;
        foldersToCheck.add(file.directory);
        this.logger.debug(`Removed file: ${file.path} (${this.formatBytes(file.size)})`);
      } catch (error) {
        this.logger.warn(`Failed to remove file ${file.path}:`, error);
      }
    }
    
    // Remove empty directories
    let foldersRemoved = 0;
    for (const folderPath of foldersToCheck) {
      try {
        const isEmpty = await this.isDirectoryEmpty(folderPath);
        if (isEmpty) {
          await fse.remove(folderPath);
          foldersRemoved++;
          this.logger.debug(`Removed empty directory: ${folderPath}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to remove directory ${folderPath}:`, error);
      }
    }
    
    return { filesRemoved, foldersRemoved, spaceFreed };
  }

  /**
   * Check if directory is empty
   */
  private async isDirectoryEmpty(dirPath: string): Promise<boolean> {
    try {
      const entries = await fse.readdir(dirPath);
      return entries.length === 0;
    } catch (error) {
      return false;
    }
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

  /**
   * Get cleanup statistics
   */
  async getCleanupStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    oldestFile: Date | null;
    newestFile: Date | null;
    diskSpace: {
      totalSpace: number;
      freeSpace: number;
      freeSpacePercent: number;
    };
  }> {
    const files = await this.getAllFilesRecursively(this.config.downloadsPath);
    const diskSpace = await this.getDiskSpaceInfo();
    
    let totalSize = 0;
    let oldestFile: Date | null = null;
    let newestFile: Date | null = null;
    
    for (const file of files) {
      totalSize += file.size;
      
      if (!oldestFile || file.createdAt < oldestFile) {
        oldestFile = file.createdAt;
      }
      
      if (!newestFile || file.createdAt > newestFile) {
        newestFile = file.createdAt;
      }
    }
    
    return {
      totalFiles: files.length,
      totalSize,
      oldestFile,
      newestFile,
      diskSpace,
    };
  }
}
