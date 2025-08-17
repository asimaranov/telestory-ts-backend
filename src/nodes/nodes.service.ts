import { Injectable, OnModuleInit } from '@nestjs/common';

import { Mutex } from 'async-mutex';
import { TelestoryNodeData } from './schema/nodes-api.schema.js';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { TelegramClient } from '@mtcute/node';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class TelestoryNodesService implements OnModuleInit {
  initialized = false;
  nodes = new Map<string, TelestoryNodeData>();
  nodeMutexes = new Map<string, Mutex>();
  @InjectModel(TelestoryNodeData.name)
  private telestoryNodes: Model<TelestoryNodeData>;
  constructor(private readonly httpService: HttpService) {}

  async onModuleInit() {
    await this.initialize();
  }

  async updateCurrentNodeStats(node: TelestoryNodeData) {
    const node_ip = await firstValueFrom(
      this.httpService.get(`${node.apiUrl}/api/v1/node/stats`, {
        headers: {
          'User-Agent': 'curl/8.4.0',
        },
      }),
    );
    node.ip = node_ip.data;
    node.apiUrl = process.env.NODE_API_URL!;
    node.type = process.env.NODE_TYPE! as 'free' | 'premium';
  }

  async masterCheckNode(node: TelestoryNodeData) {
    try {
      const nodeResponse = await firstValueFrom(
        this.httpService.get(`${node.apiUrl}/api/v1/node/stats`),
      );
      if (nodeResponse.status === 200) {
        node.approvedByMasterNode = true;
        node.lastActive = new Date();
        await node.save();
        return true;
      } else {
        node.approvedByMasterNode = false;
        await node.save();
        return false;
      }
    } catch (e) {
      node.approvedByMasterNode = false;
      await node.save();
      return false;
    }
  }

  async initialize(): Promise<void> {
    const nodes = await this.telestoryNodes.find({});

    for (const node of nodes) {
      this.nodes.set(node.ip, node);
      this.nodeMutexes.set(node.ip, new Mutex());
    }
    let node = await this.telestoryNodes.findOne({
      name: process.env.NODE_ID,
    });
    const node_ip = await firstValueFrom(
      this.httpService.get(`https://2ip.ru`, {
        headers: {
          'User-Agent': 'curl/8.4.0',
        },
      }),
    );
    if (node) {
      node.ip = node_ip.data;
      node.apiUrl = process.env.NODE_API_URL!;
      node.type = process.env.NODE_TYPE! as 'free' | 'premium';
      node.lastActive = new Date();

      await node.save();
    } else {
      // create new node
      const newNode = new this.telestoryNodes({
        name: process.env.NODE_ID,
        ip: node_ip.data,
        apiUrl: process.env.NODE_API_URL!,
        type: process.env.NODE_TYPE,
      });
      await newNode.save();
      node = newNode;
    }

    if (process.env.IS_MASTER_NODE) {
      for (const [name, node] of this.nodes) {
        if (await this.masterCheckNode(node)) {
          this.nodes.set(name, node);
          this.nodeMutexes.set(name, new Mutex());
        }
      }
    }

    this.initialized = true;
  }
}
