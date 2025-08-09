import { Injectable, OnModuleInit } from '@nestjs/common';

import { Mutex } from 'async-mutex';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { TelegramClient } from '@mtcute/node';
import { TelestoryNodesService } from '../nodes/nodes.service.js';
import { DownloadsStatsData } from './schema/downloads-stats.schema.js';

@Injectable()
export class DownloadsStatsService implements OnModuleInit {
  initialized = false;
  @InjectModel(DownloadsStatsData.name)
  private downloadsStats: Model<DownloadsStatsData>;

  constructor(private telestoryNodesService: TelestoryNodesService) {}

  async onModuleInit() {
    await this.initialize();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.initialized = true;
  }

  async addDownloadStats(
    nodeName: string,
    accountName: string,
    fileSize: number,
    fileType: string,
  ) {
    const downloadStats = new this.downloadsStats({
      timestamp: new Date(),
      nodeName,
      accountName,
      fileSize,
      fileType,
    });
    await downloadStats.save();
  }

  async getNodeDownloadsStats(
    nodeName: string,
    startDate: Date,
    endDate: Date,
  ) {
    const downloadsStats = await this.downloadsStats.find({
      nodeName,
      timestamp: { $gte: startDate, $lte: endDate },
    });
    return downloadsStats;
  }

  async getAccountDownloadsStats(
    accountName: string,
    startDate: Date,
    endDate: Date,
  ) {
    const downloadsStats = await this.downloadsStats.find({
      accountName,
      timestamp: { $gte: startDate, $lte: endDate },
    });
    return downloadsStats;
  }

  async getDownloadsStats(startDate: Date, endDate: Date) {
    const downloadsStats = await this.downloadsStats.find({
      timestamp: { $gte: startDate, $lte: endDate },
    });
    return downloadsStats;
  }
}
