import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as os from 'os';
import * as geoip from 'geoip-lite';
import { firstValueFrom } from 'rxjs';
import { ServerInfoResponseDto } from './schema/server-info.schema';

@Injectable()
export class ServerInfoService {
  private readonly logger = new Logger(ServerInfoService.name);

  constructor(private readonly httpService: HttpService) {}

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

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

  async getServerInfo(): Promise<ServerInfoResponseDto> {
    try {
      // Get public IP address
      const ipAddress = await this.getPublicIpAddress();

      // Get geolocation data
      const geoData = geoip.lookup(ipAddress);

      // Get OS information
      const osInfo = {
        os: os.type(),
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
      };

      // Get system information
      const uptimeSeconds = Math.floor(os.uptime());
      const totalMemoryBytes = os.totalmem();
      const freeMemoryBytes = os.freemem();

      const systemInfo = {
        uptime: uptimeSeconds,
        uptimeHuman: this.formatUptime(uptimeSeconds),
        totalMemory: totalMemoryBytes,
        totalMemoryHuman: this.formatBytes(totalMemoryBytes),
        freeMemory: freeMemoryBytes,
        freeMemoryHuman: this.formatBytes(freeMemoryBytes),
        cpus: os.cpus().map((cpu) => ({
          model: cpu.model,
          speed: cpu.speed,
        })),
      };

      // Combine all information
      const serverInfo: ServerInfoResponseDto = {
        ...osInfo,
        ...systemInfo,
        ipAddress,
        country: geoData?.country || undefined,
        countryCode: geoData?.country || undefined,
        city: geoData?.city || undefined,
        region: geoData?.region || undefined,
      };

      return serverInfo;
    } catch (error) {
      this.logger.error('Failed to get server info', error);
      throw error;
    }
  }

  private async getPublicIpAddress(): Promise<string> {
    try {
      // Try multiple IP services in case one fails
      const ipServices = [
        'https://api.ipify.org',
        'https://ipv4.icanhazip.com',
        'https://checkip.amazonaws.com',
      ];

      for (const service of ipServices) {
        try {
          const response = await firstValueFrom(
            this.httpService.get(service, {
              timeout: 5000,
              headers: { 'User-Agent': 'TeleStory-Server-Info/1.0' },
            }),
          );

          const ip = response.data.trim();
          if (this.isValidIpAddress(ip)) {
            return ip;
          }
        } catch (error) {
          this.logger.warn(`Failed to get IP from ${service}`, error.message);
          continue;
        }
      }

      throw new Error('Failed to get public IP address from all services');
    } catch (error) {
      this.logger.error('Failed to get public IP address', error);
      return 'unknown';
    }
  }

  private isValidIpAddress(ip: string): boolean {
    const ipv4Regex =
      /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
  }
}
