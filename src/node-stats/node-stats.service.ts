import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { firstValueFrom } from 'rxjs';
import * as os from 'os';
import * as fs from 'fs';
import * as fse from 'fs-extra';
import * as path from 'path';

import { TelestoryNodesService } from '../nodes/nodes.service.js';
import { DownloadsStatsService } from '../downloads-stats/downloads-stats.service.js';
import { TelestoryAccountData } from '../accounts/schema/telestory-account.schema.js';
import {
  AllNodesStatsDto,
  SingleNodeStatsDto,
  NodeAccountsStatsDto,
  NodeRequestStatsDto,
  NodeSystemStatsDto,
} from './schema/node-stats.schema.js';

@Injectable()
export class NodeStatsService {
  private readonly logger = new Logger(NodeStatsService.name);

  constructor(
    private readonly nodesService: TelestoryNodesService,
    private readonly httpService: HttpService,
    @InjectModel(TelestoryAccountData.name)
    private readonly accountsModel: Model<TelestoryAccountData>,
    private readonly downloadsStatsService: DownloadsStatsService,
  ) {}

  /**
   * Get stats for all nodes (can be called from any node)
   */
  async getAllNodesStats(): Promise<AllNodesStatsDto> {
    const nodes = Array.from(this.nodesService.nodes.values());
    const nodeStats: SingleNodeStatsDto[] = [];

    let totalAccounts = 0;
    let totalActiveAccounts = 0;
    let totalRequestsLastDay = 0;
    let totalDiskSpaceUsed = 0;
    let activeNodes = 0;
    let approvedNodes = 0;

    for (const node of nodes) {
      try {
        let stats: SingleNodeStatsDto;

        // If this is the current node, get local stats
        if (node.name === process.env.NODE_ID) {
          stats = await this.getCurrentNodeStats();
        } else {
          // For other nodes, try to get remote stats
          try {
            stats = await this.getRemoteNodeStats(node);
          } catch (error) {
            console.log('Failed to get remote node stats', node, error);
            // mark node as inactive
            node.approvedByMasterNode = false;
            node.isActive = false;
            await node.save();
            continue;
          }
        }

        nodeStats.push(stats);

        // Aggregate summary data
        totalAccounts += stats.accountsStats.totalAccounts;
        console.log('Updating totalAccounts', totalAccounts);
        totalActiveAccounts += stats.accountsStats.activeAccounts;
        totalRequestsLastDay += stats.requestStats.requestsLastDay;
        totalDiskSpaceUsed +=
          stats.systemStats.totalDiskSpace - stats.systemStats.freeDiskSpace;

        if (stats.isActive) activeNodes++;
        if (stats.approvedByMaster) approvedNodes++;
      } catch (error) {
        this.logger.error(`Failed to get stats for node ${node.name}:`, error);
        // Add failed node with basic info
        nodeStats.push({
          nodeId: node.name,
          nodeName: node.name,
          nodeIp: node.ip,
          nodeApiUrl: node.apiUrl,
          nodeType: node.type,
          isActive: node.isActive,
          approvedByMaster: node.approvedByMasterNode,
          lastActive: node.lastActive.toISOString(),
          accountsStats: {
            totalAccounts: 0,
            activeAccounts: 0,
            inactiveAccounts: 0,
            inactiveAccountsDetails: [],
          },
          requestStats: {
            requestsLastHour: 0,
            requestsLastDay: 0,
            requestsLastWeek: 0,
            requestsLastMonth: 0,
            totalDownloadSize: 0,
            totalDownloadSizeFormatted: '0 B',
          },
          systemStats: {
            totalDiskSpace: 0,
            freeDiskSpace: 0,
            freeDiskSpacePercent: 0,
            totalDiskSpaceFormatted: '0 B',
            freeDiskSpaceFormatted: '0 B',
            usedDiskSpaceFormatted: '0 B',
            uptime: 0,
            uptimeFormatted: '0s',
            totalMemory: 0,
            freeMemory: 0,
            usedMemory: 0,
            totalMemoryFormatted: '0 B',
            freeMemoryFormatted: '0 B',
            usedMemoryFormatted: '0 B',
            cpus: [],
          },
          statsCollectionSuccess: false,
          statsCollectionError: error.message,
        });
      }
    }

    return {
      nodes: nodeStats,
      summary: {
        totalNodes: nodes.length,
        activeNodes,
        inactiveNodes: nodes.length - activeNodes,
        approvedNodes,
        totalAccounts,
        totalActiveAccounts,
        totalRequestsLastDay,
        totalDiskSpaceUsed,
        totalDiskSpaceUsedFormatted: this.formatBytes(totalDiskSpaceUsed),
      },
      collectedAt: new Date().toISOString(),
    };
  }

  /**
   * Get stats for current node
   */
  async getCurrentNodeStats(): Promise<SingleNodeStatsDto> {
    const currentNodeName = process.env.NODE_ID;
    const nodeData = await this.nodesService.telestoryNodes.findOne({
      name: currentNodeName,
    });

    if (!nodeData) {
      throw new Error('Current node not found in database');
    }

    // Collect stats with individual error handling
    const [accountsStats, requestStats, systemStats] = await Promise.allSettled(
      [
        this.getLocalAccountsStats(),
        this.getLocalRequestStats(),
        this.getLocalSystemStats(),
      ],
    );

    if (accountsStats.status === 'fulfilled') {
      console.log('Accounts stats', accountsStats.value);
    }
    if (requestStats.status === 'fulfilled') {
      console.log('Request stats', requestStats.value);
    }
    if (systemStats.status === 'fulfilled') {
      console.log('System stats', systemStats.value);
    }

    if (accountsStats.status === 'rejected') {
      console.log('Accounts stats rejected', accountsStats.reason);
    }
    if (requestStats.status === 'rejected') {
      console.log('Request stats rejected', requestStats.reason);
    }
    if (systemStats.status === 'rejected') {
      console.log('System stats rejected', systemStats.reason);
    }

    // Extract results or provide fallbacks
    const finalAccountsStats =
      accountsStats.status === 'fulfilled'
        ? accountsStats.value
        : {
            totalAccounts: 0,
            activeAccounts: 0,
            inactiveAccounts: 0,
            inactiveAccountsDetails: [],
          };

    const finalRequestStats =
      requestStats.status === 'fulfilled'
        ? requestStats.value
        : {
            requestsLastHour: 0,
            requestsLastDay: 0,
            requestsLastWeek: 0,
            requestsLastMonth: 0,
            totalDownloadSize: 0,
            totalDownloadSizeFormatted: '0 B',
          };

    const finalSystemStats =
      systemStats.status === 'fulfilled'
        ? systemStats.value
        : {
            totalDiskSpace: 0,
            freeDiskSpace: 0,
            freeDiskSpacePercent: 0,
            totalDiskSpaceFormatted: '0 B',
            freeDiskSpaceFormatted: '0 B',
            usedDiskSpaceFormatted: '0 B',
            uptime: 0,
            uptimeFormatted: '0s',
            totalMemory: 0,
            freeMemory: 0,
            usedMemory: 0,
            totalMemoryFormatted: '0 B',
            freeMemoryFormatted: '0 B',
            usedMemoryFormatted: '0 B',
            cpus: [],
          };

    // Log any failures
    if (accountsStats.status === 'rejected') {
      this.logger.warn(`Failed to get accounts stats: ${accountsStats.reason}`);
    }
    if (requestStats.status === 'rejected') {
      this.logger.warn(`Failed to get request stats: ${requestStats.reason}`);
    }
    if (systemStats.status === 'rejected') {
      this.logger.warn(`Failed to get system stats: ${systemStats.reason}`);
    }

    const hasAnyFailures = [accountsStats, requestStats, systemStats].some(
      (result) => result.status === 'rejected',
    );

    return {
      nodeId: nodeData.name,
      nodeName: nodeData.name,
      nodeIp: nodeData.ip,
      nodeApiUrl: nodeData.apiUrl,
      nodeType: nodeData.type,
      isActive: nodeData.isActive,
      approvedByMaster: nodeData.approvedByMasterNode,
      lastActive: nodeData.lastActive.toISOString(),
      accountsStats: finalAccountsStats,
      requestStats: finalRequestStats,
      systemStats: finalSystemStats,
      statsCollectionSuccess: !hasAnyFailures,
      statsCollectionError: hasAnyFailures
        ? 'Some stats collection components failed (check logs)'
        : undefined,
    };
  }

  /**
   * Get stats from a remote node
   */
  private async getRemoteNodeStats(node: any): Promise<SingleNodeStatsDto> {
    try {
      console.log('Getting remote node stats', node);
      const response = await firstValueFrom(
        this.httpService.get(`${node.apiUrl}node/stats`, {
          timeout: 10000,
          headers: {
            'User-Agent': 'TeleStory-Master-Node/1.0',
            // login password admin: 'WvVjPsyZ'
            Authorization: `Basic ${Buffer.from('admin:WvVjPsyZ').toString('base64')}`,
          },
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to fetch stats from ${node.apiUrl}:`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * Get accounts statistics for current node
   */
  private async getLocalAccountsStats(): Promise<NodeAccountsStatsDto> {
    try {
      const currentNodeId = process.env.NODE_ID;

      // Get all accounts for this node
      const allAccounts = await this.accountsModel
        .find({ bindNodeId: currentNodeId })
        .exec();
      const activeAccounts = allAccounts.filter((acc) => acc.isActive);
      const inactiveAccounts = allAccounts.filter((acc) => !acc.isActive);

      const inactiveAccountsDetails = inactiveAccounts.map((acc) => ({
        name: acc.name,
        reason: acc.inactiveReason || 'Unknown',
        lastActive: acc.lastActive.toISOString(),
      }));

      return {
        totalAccounts: allAccounts.length,
        activeAccounts: activeAccounts.length,
        inactiveAccounts: inactiveAccounts.length,
        inactiveAccountsDetails,
      };
    } catch (error) {
      this.logger.warn(`Failed to get accounts stats:`, error.message);
      throw error;
    }
  }

  /**
   * Get request statistics for current node
   */
  private async getLocalRequestStats(): Promise<NodeRequestStatsDto> {
    const currentNodeId = process.env.NODE_ID;
    const now = new Date();

    // Calculate time ranges
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    try {
      // Get download stats for different time ranges
      const [lastHourStats, lastDayStats, lastWeekStats, lastMonthStats] =
        await Promise.all([
          this.downloadsStatsService.getNodeDownloadsStats(
            currentNodeId!,
            oneHourAgo,
            now,
          ),
          this.downloadsStatsService.getNodeDownloadsStats(
            currentNodeId!,
            oneDayAgo,
            now,
          ),
          this.downloadsStatsService.getNodeDownloadsStats(
            currentNodeId!,
            oneWeekAgo,
            now,
          ),
          this.downloadsStatsService.getNodeDownloadsStats(
            currentNodeId!,
            oneMonthAgo,
            now,
          ),
        ]);

      // Calculate total download size
      const totalDownloadSize = lastMonthStats.reduce(
        (sum, stat) => sum + stat.fileSize,
        0,
      );

      return {
        requestsLastHour: lastHourStats.length,
        requestsLastDay: lastDayStats.length,
        requestsLastWeek: lastWeekStats.length,
        requestsLastMonth: lastMonthStats.length,
        totalDownloadSize,
        totalDownloadSizeFormatted: this.formatBytes(totalDownloadSize),
      };
    } catch (error) {
      this.logger.warn(
        `Failed to get request stats for node ${currentNodeId}:`,
        error.message,
      );
      // Return fallback stats
      return {
        requestsLastHour: 0,
        requestsLastDay: 0,
        requestsLastWeek: 0,
        requestsLastMonth: 0,
        totalDownloadSize: 0,
        totalDownloadSizeFormatted: '0 B',
      };
    }
  }

  /**
   * Get system statistics for current node
   */
  private async getLocalSystemStats(): Promise<NodeSystemStatsDto> {
    // Get disk space info
    const diskSpaceInfo = await this.getDiskSpaceInfo();

    // Get system info
    const uptimeSeconds = Math.floor(os.uptime());
    const totalMemoryBytes = os.totalmem();
    const freeMemoryBytes = os.freemem();

    // Calculate used space and memory
    const usedDiskSpace = diskSpaceInfo.totalSpace - diskSpaceInfo.freeSpace;
    const usedMemoryBytes = totalMemoryBytes - freeMemoryBytes;

    return {
      totalDiskSpace: diskSpaceInfo.totalSpace,
      freeDiskSpace: diskSpaceInfo.freeSpace,
      freeDiskSpacePercent: diskSpaceInfo.freeSpacePercent,
      totalDiskSpaceFormatted: this.formatBytes(diskSpaceInfo.totalSpace),
      freeDiskSpaceFormatted: this.formatBytes(diskSpaceInfo.freeSpace),
      usedDiskSpaceFormatted: this.formatBytes(usedDiskSpace),
      uptime: uptimeSeconds,
      uptimeFormatted: this.formatUptime(uptimeSeconds),
      totalMemory: totalMemoryBytes,
      freeMemory: freeMemoryBytes,
      usedMemory: usedMemoryBytes,
      totalMemoryFormatted: this.formatBytes(totalMemoryBytes),
      freeMemoryFormatted: this.formatBytes(freeMemoryBytes),
      usedMemoryFormatted: this.formatBytes(usedMemoryBytes),
      cpus: os.cpus().map((cpu) => ({
        model: cpu.model,
        speed: cpu.speed,
      })),
    };
  }

  /**
   * Get disk space information for the system root drive (cross-platform)
   */
  private async getDiskSpaceInfo(): Promise<{
    totalSpace: number;
    freeSpace: number;
    freeSpacePercent: number;
  }> {
    try {
      // Use cross-platform approach to get root drive disk space
      const rootPath = this.getRootPath();

      // Use Node.js fs.statSync for cross-platform disk space info
      const stats = fs.statSync(rootPath);

      // For cross-platform disk space, we need to use a different approach
      // since fs.statSync doesn't provide disk space info directly
      return await this.getCrossPlatformDiskSpace(rootPath);
    } catch (error) {
      this.logger.warn(
        'Could not get disk space info, using fallback:',
        error.message,
      );
      return {
        totalSpace: 1000000000000, // 1TB fallback
        freeSpace: 500000000000, // 500GB fallback
        freeSpacePercent: 50,
      };
    }
  }

  /**
   * Get the root path for the current platform
   */
  private getRootPath(): string {
    if (process.platform === 'win32') {
      // On Windows, get the drive letter of the current working directory
      const cwd = process.cwd();
      return cwd.substring(0, 3); // e.g., "C:\"
    } else {
      // On Unix-like systems, use root
      return '/';
    }
  }

  /**
   * Get disk space information using cross-platform methods
   */
  private async getCrossPlatformDiskSpace(rootPath: string): Promise<{
    totalSpace: number;
    freeSpace: number;
    freeSpacePercent: number;
  }> {
    const { spawn } = require('child_process');

    return new Promise((resolve, reject) => {
      let command: string;
      let args: string[];

      if (process.platform === 'win32') {
        // Windows: use wmic command
        command = 'wmic';
        args = [
          'logicaldisk',
          'where',
          `caption="${rootPath.replace('\\', '')}"`,
          'get',
          'size,freespace',
          '/format:csv',
        ];
      } else {
        // Unix-like: use df command with platform-specific options
        command = 'df';
        if (process.platform === 'darwin') {
          // macOS doesn't support -B option, use default block size and we'll convert
          args = [rootPath];
        } else {
          // Linux supports -B1 for 1-byte blocks (exact bytes)
          args = ['-B1', rootPath];
        }
      }

      const process_spawn = spawn(command, args);
      let output = '';
      let errorOutput = '';

      process_spawn.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      process_spawn.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      process_spawn.on('close', (code: number) => {
        if (code !== 0) {
          reject(
            new Error(
              `${command} command failed with code ${code}: ${errorOutput}`,
            ),
          );
          return;
        }

        try {
          let totalSpace: number;
          let freeSpace: number;

          if (process.platform === 'win32') {
            // Parse Windows wmic output
            const lines = output
              .trim()
              .split('\n')
              .filter((line) => line.includes(','));
            if (lines.length === 0) {
              throw new Error('No valid data from wmic command');
            }

            // CSV format: Node,FreeSpace,Size
            const dataLine = lines[0];
            const parts = dataLine.split(',');

            if (parts.length < 3) {
              throw new Error('Invalid wmic output format');
            }

            freeSpace = parseInt(parts[1]) || 0;
            totalSpace = parseInt(parts[2]) || 0;
          } else {
            // Parse Unix df output
            const lines = output.trim().split('\n');
            const dataLine = lines[lines.length - 1];
            const parts = dataLine.split(/\s+/);

            if (parts.length < 4) {
              throw new Error('Invalid df output format');
            }

            // df output format: Filesystem 1K-blocks Used Available Use% Mounted-on (or 512-byte blocks on macOS)
            let totalBlocks = parseInt(parts[1]) || 0;
            let availableBlocks = parseInt(parts[3]) || 0;

            if (process.platform === 'darwin') {
              // macOS uses 512-byte blocks by default
              totalSpace = totalBlocks * 512;
              freeSpace = availableBlocks * 512;
            } else {
              // Linux with -B1 uses 1-byte blocks (exact bytes)
              totalSpace = totalBlocks;
              freeSpace = availableBlocks;
            }
          }

          if (totalSpace === 0) {
            throw new Error('Total space is 0, invalid disk info');
          }

          const freeSpacePercent = (freeSpace / totalSpace) * 100;

          resolve({
            totalSpace,
            freeSpace,
            freeSpacePercent,
          });
        } catch (parseError) {
          reject(
            new Error(
              `Failed to parse disk space output: ${parseError.message}`,
            ),
          );
        }
      });

      process_spawn.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  /**
   * Format bytes to human readable format
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Format uptime to human readable format
   */
  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(' ');
  }
}
