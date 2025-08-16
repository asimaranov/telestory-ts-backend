import { Injectable, OnModuleInit } from '@nestjs/common';

import { Mutex } from 'async-mutex';
import { TelestoryAccountData } from '../schema/telestory-account.schema.js';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { SentCode, TelegramClient } from '@mtcute/node';
import { TelestoryNodesService } from '../../nodes/nodes.service.js';
import { TelestoryPendingAccountData } from '../schema/telestory-pending-account.schema.js';
import { Dispatcher, filters } from '@mtcute/dispatcher';
import { message } from '@mtcute/core/utils/links/chat.js';

@Injectable()
export class TelestoryAccountsService implements OnModuleInit {
  initialized = false;
  accounts = new Map<string, TelegramClient>();
  accountMutexes = new Map<string, Mutex>();
  accountsCounter = 0;
  botClient: TelegramClient;

  constructor(
    private telestoryNodesService: TelestoryNodesService,
    @InjectModel(TelestoryAccountData.name)
    private telestoryAccountData: Model<TelestoryAccountData>,
    @InjectModel(TelestoryPendingAccountData.name)
    private telestoryPendingAccountData: Model<TelestoryPendingAccountData>,
  ) {}

  async onModuleInit() {
    await this.initialize();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const accounts = await this.telestoryAccountData.find({
      isActive: true,
      type: 'user',
      bindNodeId: process.env.NODE_ID,
    });

    console.log(`Found ${accounts.length} accounts to import`);

    for (const account of accounts) {
      const tg = new TelegramClient({
        apiId: Number(process.env.API_ID),
        apiHash: process.env.API_HASH!,
      });

      await tg.importSession(account.sessionData);

      const dp = Dispatcher.for(tg);

      dp.onNewMessage(async (msg) => {
        console.log('New message on account', account.name, msg);
        if (msg.isOutgoing) {
          return;
        }
        await msg.answerText(
          'Привет. Я один из тайных агентов @tele_story_bot. Если ты заметил меня в своих просмотрах, значит кто-то неравнодушен к твоей жизни. Хочешь узнать кто? Переходи в бота 👈',
        );
      });

      try {
        const self = await tg.start();
        console.log(
          `Account ${account.name} imported successfully. Account: ${self.firstName} ${self.lastName} (${self.username || 'no username'}). Id: ${self.id}`,
        );
      } catch (error) {
        console.error(
          `Error importing session for account ${account.name}: ${error}`,
        );
        account.isActive = false;
        account.inactiveReason = error.message;
        await account.save();
        continue;
      }

      this.accounts.set(account.name, tg);
      this.accountMutexes.set(account.name, new Mutex());
    }

    this.botClient = new TelegramClient({
      apiId: Number(process.env.API_ID),
      apiHash: process.env.API_HASH!,
    });

    if (process.env.BOT_TOKEN) {
      console.log('Starting bot client');
      await this.botClient.start({
        botToken: process.env.BOT_TOKEN,
      });

      console.log('Bot client started');

      const botDp = Dispatcher.for(this.botClient);

      botDp.onNewMessage(async (msg) => {
        console.log('New message on bot', msg);
        await msg.answerText(`Hello from bot on server ${process.env.NODE_ID}. Bot client id: ${await this.botClient.getMyUsername()}`);
      });

      botDp.onNewMessage(filters.command('start'), async (msg) => {
        console.log('New message on bot', msg);
        await msg.answerText(
          'Аккаунты воркают: ' +
            accounts.length +
            `\n\n
            ${Array.from(accounts)
              .filter((account) => {
                return account.isActive;
              })
              .map((account) => {
                return `
                ${account.name} ${account.bindNodeId}
              `;
              })
              .join('\n')}

            Аккаунты не воркают: ${accounts.length - this.accounts.size}

            ${Array.from(accounts)
              .filter((account) => {
                return !account.isActive;
              })
              .map((account) => {
                return `
                ${account.name} ${account.bindNodeId}
              `;
              })
              .join('\n')}
            `,
        );
      });
    }

    this.initialized = true;
  }

  async addAccountByPhone(name: string, phone: string) {
    const tg = new TelegramClient({
      apiId: Number(process.env.API_ID),
      apiHash: process.env.API_HASH!,
    });

    const code = (await tg.sendCode({ phone })) as SentCode;

    const phoneCodeHash = code.phoneCodeHash;

    const bindNodeId = process.env.NODE_ID;

    const session = await tg.exportSession();

    const pendingAccount = new this.telestoryPendingAccountData({
      sessionData: session,
      name,
      bindNodeId,
      phone,
      phoneCodeHash,
    });

    await pendingAccount.save();
  }

  async confirmAccountByPhone(phone: string, phoneCode: string) {
    const pendingAccount = await this.telestoryPendingAccountData.findOne({
      phone,
    });

    if (!pendingAccount) {
      throw new Error('Pending account not found');
    }

    const tg = new TelegramClient({
      apiId: Number(process.env.API_ID),
      apiHash: process.env.API_HASH!,
    });

    await tg.importSession(pendingAccount.sessionData);

    try {
      await tg.signIn({
        phone,
        phoneCodeHash: pendingAccount.phoneCodeHash,
        phoneCode,
      });
    } catch (error) {
      if (error.message.includes('SESSION_PASSWORD_NEEDED')) {
        throw new Error('Session password needed');
      } else if (error.message.includes('PHONE_CODE_INVALID')) {
        throw new Error('Phone code invalid');
      } else if (error.message.includes('PHONE_CODE_EXPIRED')) {
        throw new Error('Phone code expired');
      } else {
        throw new Error(`Authorization failed: ${error}`);
      }
    }

    const session = await tg.exportSession();

    const account = new this.telestoryAccountData({
      name: pendingAccount.name,
      sessionData: session,
      bindNodeId: process.env.NODE_ID,
      lastActive: new Date(),
      isActive: true,
      type: 'user',
    });

    await this.telestoryPendingAccountData.deleteOne({
      _id: pendingAccount._id,
    });

    await account.save();
  }

  async getAccount(
    name: string,
  ): Promise<{ account: TelegramClient; mutex: Mutex }> {
    const account = this.accounts.get(name);
    if (!account) {
      throw new Error('Account not found');
    }
    return { account, mutex: this.accountMutexes.get(name)! };
  }

  async getNextAccount(): Promise<{ account: TelegramClient; mutex: Mutex }> {
    console.log(
      'Getting next account',
      this.accountsCounter,
      this.accounts.size,
      Array.from(this.accounts.keys()),
    );
    const name = Array.from(this.accounts.keys())[this.accountsCounter];
    console.log('Getting next account', name);
    this.accountsCounter++;
    if (this.accountsCounter >= this.accounts.size) {
      this.accountsCounter = 0;
    }
    const account = this.accounts.get(name);
    if (!account) {
      throw new Error('Account not found');
    }
    return { account, mutex: this.accountMutexes.get(name)! };
  }

  async getAccountsOnNode(): Promise<TelestoryAccountData[]> {
    return await this.telestoryAccountData
      .find({
        bindNodeId: process.env.NODE_ID,
      })
      .select('-sessionData'); // Exclude sensitive session data from response
  }
}
