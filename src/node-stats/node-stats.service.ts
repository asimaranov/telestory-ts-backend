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
          stats = await this.getRemoteNodeStats(node);
        }

        nodeStats.push(stats);

        // Aggregate summary data
        totalAccounts += stats.accountsStats.totalAccounts;
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
            uptime: 0,
            uptimeFormatted: '0s',
            totalMemory: 0,
            freeMemory: 0,
            totalMemoryFormatted: '0 B',
            freeMemoryFormatted: '0 B',
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
            uptime: 0,
            uptimeFormatted: '0s',
            totalMemory: 0,
            freeMemory: 0,
            totalMemoryFormatted: '0 B',
            freeMemoryFormatted: '0 B',
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
      const response = await firstValueFrom(
        this.httpService.get(`${node.apiUrl}api/v1/node/stats`, {
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

    return {
      totalDiskSpace: diskSpaceInfo.totalSpace,
      freeDiskSpace: diskSpaceInfo.freeSpace,
      freeDiskSpacePercent: diskSpaceInfo.freeSpacePercent,
      totalDiskSpaceFormatted: this.formatBytes(diskSpaceInfo.totalSpace),
      freeDiskSpaceFormatted: this.formatBytes(diskSpaceInfo.freeSpace),
      uptime: uptimeSeconds,
      uptimeFormatted: this.formatUptime(uptimeSeconds),
      totalMemory: totalMemoryBytes,
      freeMemory: freeMemoryBytes,
      totalMemoryFormatted: this.formatBytes(totalMemoryBytes),
      freeMemoryFormatted: this.formatBytes(freeMemoryBytes),
      cpus: os.cpus().map((cpu) => ({
        model: cpu.model,
        speed: cpu.speed,
      })),
    };
  }

  /**
   * Get disk space information (reused from downloads-cleaner)
   */
  private async getDiskSpaceInfo(): Promise<{
    totalSpace: number;
    freeSpace: number;
    freeSpacePercent: number;
  }> {
    try {
      const downloadsPath = path.join(process.cwd(), 'downloads');
      const { spawn } = require('child_process');

      return new Promise((resolve, reject) => {
        const df = spawn('df', [downloadsPath]);
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
          const dataLine = lines[lines.length - 1];
          const parts = dataLine.split(/\s+/);

          const totalSpace = parseInt(parts[1]) * 1024;
          const freeSpace = parseInt(parts[3]) * 1024;
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
      return {
        totalSpace: 1000000000000, // 1TB fallback
        freeSpace: 500000000000, // 500GB fallback
        freeSpacePercent: 50,
      };
    }
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
