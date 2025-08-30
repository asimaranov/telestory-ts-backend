import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { DownloaderService } from './downloader/downloader.service';
import { HttpService } from '@nestjs/axios';
import { TelestoryNodesService } from './nodes/nodes.service';
import { NodeStatsService } from './node-stats/node-stats.service';
import { firstValueFrom } from 'rxjs';
import { TelestoryAccountsService } from './accounts/regular-node/telestory-accounts.service';

export class GetStoriesByUsernameQueryDto {
  api_key: string;
  username: string;
  archive?: string;
  mark?: string;
  premium?: string;
  story_ids?: string;
}

export class GetUserIdByUsernameQueryDto {
  api_key: string;
  username: string;
}

@ApiTags('app')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly downloaderService: DownloaderService,
    private readonly httpService: HttpService,
    private readonly nodesService: TelestoryNodesService,
    private readonly nodeStatsService: NodeStatsService,
    private readonly telestoryAccountsService: TelestoryAccountsService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('get_stories_by_username')
  @ApiOperation({
    summary: 'Get stories by username with node selection',
    description:
      'Retrieves stories for a given username by selecting the best available node and routing the request appropriately. Falls back to direct processing if needed.',
  })
  @ApiQuery({
    name: 'api_key',
    description: 'API key for authentication',
    required: true,
  })
  @ApiQuery({
    name: 'username',
    description: 'Username to get stories for',
    required: true,
  })
  @ApiQuery({
    name: 'archive',
    description: 'Whether to get archived/pinned stories',
    required: false,
  })
  @ApiQuery({
    name: 'mark',
    description: 'Whether to mark stories as read',
    required: false,
  })
  @ApiQuery({
    name: 'premium',
    description: 'Whether to use premium features',
    required: false,
  })
  @ApiQuery({
    name: 'story_ids',
    description: 'Story IDs to get',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Stories retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async getStoriesByUsername(@Query() query: GetStoriesByUsernameQueryDto) {
    // Validate API key first
    if (!query.api_key) {
      throw new Error('API key is required');
    }

    if (query.api_key !== process.env.API_KEY) {
      console.log('Invalid API key', query.api_key, process.env.API_KEY);
      throw new Error('Invalid API key');
    }

    if (!query.username) {
      throw new Error('Username is required');
    }

    // Convert string parameters to boolean
    const archive = query.archive === 'true';
    const markAsRead = query.mark === 'true';
    const premium = query.premium === 'true';

    // Select the best node for the request
    const bestNode = await this.selectBestNode(premium);

    if (!bestNode || bestNode.name === process.env.NODE_ID) {
      // If no best node found or we are the best node, process locally
      console.log('Processing request locally on current node');

      const storyIds = query.story_ids
        ? query.story_ids.split(',').map((id) => id.trim())
        : [];

      const result = await this.downloaderService.getStoryByUsername(
        query.username,
        archive,
        markAsRead,
        storyIds,
        premium,
      );

      return {
        ...result,
        node: process.env.NODE_ID,
        routeLog: !bestNode ? 'direct_best_not_found' : 'direct_current_chosen',
      };
    }

    // Forward request to the selected node
    console.log(
      `Forwarding request to node: ${bestNode.name} (${bestNode.apiUrl})`,
    );

    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${bestNode.apiUrl}get_stories_by_username_direct`,
          {
            params: {
              api_key: query.api_key,
              username: query.username,
              archive: query.archive,
              mark: query.mark,
              premium: query.premium,
              story_ids: query.story_ids,
            },
            timeout: 30000,
            headers: {
              'User-Agent': 'TeleStory-Master-Node/1.0',
            },
          },
        ),
      );

      return {
        ...response.data,
        node: bestNode.name,
        routeLog: 'remote_node_chosen',
      };
    } catch (error) {
      console.error(
        `Failed to forward request to ${bestNode.name}:`,
        error.message,
      );

      // Fallback to local processing if remote node fails
      console.log('Falling back to local processing');

      const storyIds = query.story_ids
        ? query.story_ids.split(',').map((id) => id.trim())
        : [];

      const result = await this.downloaderService.getStoryByUsername(
        query.username,
        archive,
        markAsRead,
        storyIds,
        premium,
      );

      // Mark node as inactive
      bestNode.approvedByMasterNode = false;
      bestNode.isActive = false;
      await bestNode.save();

      return {
        ...result,
        node: process.env.NODE_ID,
        fallbackError: error.message,
        fallbackNode: bestNode.name,
        routeLog: `local_node_remote_error_fallback_${error.message}`,
      };
    }
  }

  /**
   * Selects the best node for processing the request based on node stats and availability
   */
  private async selectBestNode(isPremium: boolean = false) {
    const nodes = Array.from(this.nodesService.nodes.values());

    if (nodes.length === 0) {
      return null;
    }

    // Filter nodes based on type and activity
    const availableNodes = nodes.filter(
      (node) =>
        node.isActive &&
        !!node.apiUrl &&
        // node.approvedByMasterNode &&
        (!isPremium || node.type === 'premium' || node.type === 'free'), // Premium requests can use any node, but prefer premium
    );

    if (availableNodes.length === 0) {
      return null;
    }

    // If only one node available, return it
    if (availableNodes.length === 1) {
      return availableNodes[0];
    }

    try {
      // Get stats for all nodes to make informed selection
      const allNodesStats = await this.nodeStatsService.getAllNodesStats();

      // Create a map of node stats for easy lookup
      const nodeStatsMap = new Map();
      for (const nodeStats of allNodesStats.nodes) {
        nodeStatsMap.set(nodeStats.nodeId, nodeStats);
      }

      // Filter out nodes without accounts and calculate scores
      const nodeScores: Array<{
        node: any;
        stats: any;
        score: number;
      }> = [];

      for (const node of availableNodes) {
        const stats = nodeStatsMap.get(node.name);

        // Skip nodes without stats or without active accounts
        if (
          !stats ||
          !stats.accountsStats ||
          stats.accountsStats.activeAccounts === 0
        ) {
          console.log(`Skipping node ${node.name}: no active accounts`);
          continue;
        }

        // Calculate node score (higher score = better)
        const score = this.calculateNodeScore(node, stats, isPremium);

        nodeScores.push({
          node,
          stats,
          score,
        });

        console.log(
          `Node ${node.name}: accounts=${stats.accountsStats.activeAccounts}, requests/hour=${stats.requestStats.requestsLastHour}, score=${score}`,
        );
      }

      // If no nodes have active accounts, fall back to basic selection
      if (nodeScores.length === 0) {
        console.log(
          'No nodes with active accounts found, falling back to basic selection',
        );
        return this.selectBestNodeBasic(availableNodes, isPremium);
      }

      // Sort by score (highest first) and return the best node
      nodeScores.sort((a, b) => b.score - a.score);
      const bestNode = nodeScores[0].node;

      console.log(
        `Selected best node: ${bestNode.name} with score ${nodeScores[0].score}`,
      );
      return bestNode;
    } catch (error) {
      console.error(
        'Failed to get node stats for selection, falling back to basic selection:',
        error.message,
      );
      return this.selectBestNodeBasic(availableNodes, isPremium);
    }
  }

  /**
   * Calculate a score for a node based on accounts and loading
   * Higher score means better node for selection
   */
  private calculateNodeScore(
    node: any,
    stats: any,
    isPremium: boolean,
  ): number {
    let score = 0;

    // Base score from active accounts (more accounts = higher score)
    const activeAccounts = stats.accountsStats.activeAccounts;
    score += activeAccounts * 10; // 10 points per active account

    // Bonus for premium nodes when premium is requested
    if (isPremium && node.type === 'premium') {
      score += 50; // 50 point bonus for premium nodes on premium requests
    }

    // Penalty based on current load (requests per hour)
    const requestsPerHour = stats.requestStats.requestsLastHour;
    const loadPenalty = Math.min(requestsPerHour * 2, 100); // Max penalty of 100 points
    score -= loadPenalty;

    // Penalty based on memory usage (if available)
    if (stats.systemStats && stats.systemStats.totalMemory > 0) {
      const memoryUsagePercent =
        (stats.systemStats.usedMemory / stats.systemStats.totalMemory) * 100;
      if (memoryUsagePercent > 80) {
        score -= 30; // High memory usage penalty
      } else if (memoryUsagePercent > 60) {
        score -= 15; // Medium memory usage penalty
      }
    }

    // Penalty based on disk usage (if available)
    if (stats.systemStats && stats.systemStats.totalDiskSpace > 0) {
      const diskUsagePercent = 100 - stats.systemStats.freeDiskSpacePercent;
      if (diskUsagePercent > 90) {
        score -= 25; // High disk usage penalty
      } else if (diskUsagePercent > 75) {
        score -= 10; // Medium disk usage penalty
      }
    }

    // Small bonus for less recent activity (fresher nodes)
    const hoursSinceLastActive =
      (Date.now() - new Date(node.lastActive).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastActive < 1) {
      score += 5; // Recently active bonus
    }

    return Math.max(score, 0); // Ensure score is not negative
  }

  /**
   * Fallback selection method when stats are not available
   */
  private selectBestNodeBasic(availableNodes: any[], isPremium: boolean) {
    let bestNode = availableNodes[0];

    for (const node of availableNodes) {
      // Prefer premium nodes for premium requests
      if (isPremium && node.type === 'premium' && bestNode.type !== 'premium') {
        bestNode = node;
        continue;
      }

      // If both are same type or neither is premium when premium is needed, prefer less recently active
      if ((isPremium && node.type === bestNode.type) || !isPremium) {
        if (node.lastActive < bestNode.lastActive) {
          bestNode = node;
        }
      }
    }

    return bestNode;
  }

  @Get('get_stories_by_username_direct')
  @ApiOperation({
    summary: 'Get stories by username',
    description:
      'Retrieves stories for a given username with optional parameters for archive, marking as read, and premium features',
  })
  @ApiQuery({
    name: 'api_key',
    description: 'API key for authentication',
    required: true,
  })
  @ApiQuery({
    name: 'username',
    description: 'Username to get stories for',
    required: true,
  })
  @ApiQuery({
    name: 'archive',
    description: 'Whether to get archived/pinned stories',
    required: false,
  })
  @ApiQuery({
    name: 'mark',
    description: 'Whether to mark stories as read',
    required: false,
  })
  @ApiQuery({
    name: 'premium',
    description: 'Whether to use premium features',
    required: false,
  })
  @ApiQuery({
    name: 'story_ids',
    description: 'Story IDs to get',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Stories retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async getStoriesByUsernameDirect(
    @Query() query: GetStoriesByUsernameQueryDto,
  ) {
    // Convert string parameters to boolean
    const archive = query.archive === 'true';
    const markAsRead = query.mark === 'true';
    const premium = query.premium === 'true';

    // For now, we'll just validate that api_key is provided
    // You can add proper API key validation logic here
    if (!query.api_key) {
      throw new Error('API key is required');
    }

    if (query.api_key !== process.env.API_KEY) {
      console.log('Invalid API key', query.api_key, process.env.API_KEY);
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

  @Get('get_user_id_by_username')
  @ApiOperation({
    summary: 'Get user ID by username or phone number',
    description:
      'Resolves a username or phone number to get the corresponding Telegram user ID and actual username',
  })
  @ApiQuery({
    name: 'api_key',
    description: 'API key for authentication',
    required: true,
  })
  @ApiQuery({
    name: 'username',
    description: 'Username or phone number to resolve',
    required: true,
  })
  @ApiResponse({ status: 200, description: 'User ID retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async getUserIdByUsername(@Query() query: GetUserIdByUsernameQueryDto) {
    try {
      // Validate API key
      if (!query.api_key) {
        return { ok: false, error: 'API key is required' };
      }

      if (query.api_key !== process.env.API_KEY) {
        return { ok: false, error: 'Invalid api token' };
      }

      if (!query.username) {
        return { ok: false, error: 'Username is required' };
      }

      // Get next account and bot client
      const { account: client } =
        await this.telestoryAccountsService.getNextAccount();

      let userId: number;
      let actualUsername: string | undefined = query.username;

      if (query.username.match(/^\d+$/)) {
        // Handle phone number
        try {
          const contacts = await client.importContacts([
            {
              phone: `+${query.username}`,
              firstName: query.username,
              lastName: query.username,
            },
          ]);

          if (!contacts.users || contacts.users.length === 0) {
            return { ok: false, error: 'Invalid phone number' };
          }

          const user = contacts.users[0];
          userId = user.id;
          actualUsername = (user as any).username;
        } catch (error) {
          console.error('Error importing contact:', error);
          return {
            ok: false,
            error: 'Unknown error',
            error_debug: error.message,
          };
        }
      } else {
        // Handle username
        try {
          const resolvedPeer = await client.resolvePeer(query.username);

          if (resolvedPeer._ === 'inputPeerUser') {
            userId = resolvedPeer.userId;
            // We already have the username from the query
            actualUsername = query.username.replace(/^@/, '');
          } else {
            return { ok: false, error: 'Not a user' };
          }
        } catch (error) {
          console.error('Error resolving username:', error);
          return {
            ok: false,
            error: 'Unknown error',
            error_debug: error.message,
          };
        }
      }

      return {
        ok: true,
        user_id: userId,
        username: actualUsername,
      };
    } catch (error) {
      console.error('Error in getUserIdByUsername:', error);
      return {
        ok: false,
        error: 'Unknown error',
        error_debug: error.message,
      };
    }
  }
}
