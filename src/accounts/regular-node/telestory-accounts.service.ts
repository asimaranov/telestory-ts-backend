import { Injectable, OnModuleInit, Inject, forwardRef } from '@nestjs/common';

import { Mutex } from 'async-mutex';
import { TelestoryAccountData } from '../schema/telestory-account.schema.js';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { SentCode, TelegramClient } from '@mtcute/node';
import { TelestoryNodesService } from '../../nodes/nodes.service.js';
import { TelestoryPendingAccountData } from '../schema/telestory-pending-account.schema.js';
import { NodeStatsService } from '../../node-stats/node-stats.service.js';
import {
  CallbackDataBuilder,
  Dispatcher,
  filters,
  MemoryStateStorage,
  PropagationAction,
} from '@mtcute/dispatcher';
import { message } from '@mtcute/core/utils/links/chat.js';
import { WizardScene, WizardSceneAction } from '@mtcute/dispatcher';
import { BotKeyboard } from '@mtcute/core';
import { PhoneUtils } from '../../common/utils/phone.utils';
import { md } from '@mtcute/markdown-parser';

interface AddAccountState {
  nodeId?: string;
  name?: string;
  phone?: string;
  phoneCode?: string;
}

const ChooseNodeButton = new CallbackDataBuilder('choose_node', 'nodeId');
const PinpadDigit = new CallbackDataBuilder('pinpad_digit', 'digit');
const PinpadAction = new CallbackDataBuilder('pinpad_action', 'action');

function createPinpadKeyboard(currentCode: string = '') {
  const keyboard = [
    // Row 1: 1, 2, 3
    [
      BotKeyboard.callback('1', PinpadDigit.build({ digit: '1' })),
      BotKeyboard.callback('2', PinpadDigit.build({ digit: '2' })),
      BotKeyboard.callback('3', PinpadDigit.build({ digit: '3' })),
    ],
    // Row 2: 4, 5, 6
    [
      BotKeyboard.callback('4', PinpadDigit.build({ digit: '4' })),
      BotKeyboard.callback('5', PinpadDigit.build({ digit: '5' })),
      BotKeyboard.callback('6', PinpadDigit.build({ digit: '6' })),
    ],
    // Row 3: 7, 8, 9
    [
      BotKeyboard.callback('7', PinpadDigit.build({ digit: '7' })),
      BotKeyboard.callback('8', PinpadDigit.build({ digit: '8' })),
      BotKeyboard.callback('9', PinpadDigit.build({ digit: '9' })),
    ],
    // Row 4: Clear, 0, Backspace
    [
      BotKeyboard.callback(
        '🔄 Очистить',
        PinpadAction.build({ action: 'clear' }),
      ),
      BotKeyboard.callback('0', PinpadDigit.build({ digit: '0' })),
      BotKeyboard.callback(
        '⬅️ Стереть',
        PinpadAction.build({ action: 'backspace' }),
      ),
    ],
    // Row 5: Submit and Cancel
    [
      BotKeyboard.callback(
        '✅ Подтвердить',
        PinpadAction.build({ action: 'submit' }),
      ),
      BotKeyboard.callback('❌ Отмена', 'CANCEL'),
    ],
  ];

  return BotKeyboard.inline(keyboard);
}

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
    @Inject(forwardRef(() => NodeStatsService))
    private nodeStatsService: NodeStatsService,
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
        storage: `session-${account.name}`,
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

    if (process.env.BOT_TOKEN) {
      this.botClient = new TelegramClient({
        apiId: Number(process.env.API_ID),
        apiHash: process.env.API_HASH!,
        storage: `session-bot-${process.env.BOT_TOKEN.split(':')[0]}`,
      });

      console.log('Starting bot client');
      await this.botClient.start({
        botToken: process.env.BOT_TOKEN,
      });

      console.log('Bot client started');

      const wizardScene = new WizardScene<AddAccountState>('add_account', {
        storage: new MemoryStateStorage(),
      });

      wizardScene.addStep(async (msg, state) => {
        console.log('Add account name', msg.text);
        await state.merge({ name: msg.text }, { fallback: {} });

        await msg.answerText('Введи номер телефона', {
          replyMarkup: BotKeyboard.inline([
            [BotKeyboard.callback('Cancel', 'CANCEL')],
          ]),
        });

        return WizardSceneAction.Next;
      });

      wizardScene.addStep(async (msg, state) => {
        const { name } = (await state.get()) as AddAccountState;

        let phone: string;
        try {
          phone = PhoneUtils.normalize(msg.text);
        } catch (error) {
          let errorMessage = 'Неправильный формат номера телефона.';
          if (error.message.includes('INVALID_COUNTRY')) {
            errorMessage =
              'Неправильный формат номера. Введи номер в формате +7XXXXXXXXXX или 8XXXXXXXXXX';
          } else if (error.message.includes('Invalid phone number')) {
            errorMessage =
              'Неправильный номер телефона. Проверь правильность введенного номера.';
          }

          await msg.answerText(errorMessage + ' Попробуй еще раз:', {
            replyMarkup: BotKeyboard.inline([
              [BotKeyboard.callback('Cancel', 'CANCEL')],
            ]),
          });
          return WizardSceneAction.Stay;
        }

        await state.merge({ phone });

        try {
          await this.addAccountByPhone(name!, phone);
        } catch (error) {
          await msg.answerText(
            'Ошибка при добавлении аккаунта: ' +
              error.message +
              ' Введи новый номер телефона',
            {
              replyMarkup: BotKeyboard.inline([
                [BotKeyboard.callback('Cancel', 'CANCEL')],
              ]),
            },
          );
          throw error;
        }

        await msg.answerText('Введи код из СМС:\n\nКод: (не введен)', {
          replyMarkup: createPinpadKeyboard(),
        });

        return WizardSceneAction.Next;
      });

      wizardScene.addStep(async (msg, state) => {
        // This step is now handled by callback queries, so we redirect to pinpad
        await msg.answerText(
          'Используйте клавиатуру ниже для ввода кода из СМС:',
          {
            replyMarkup: createPinpadKeyboard(),
          },
        );

        return WizardSceneAction.Stay;
      });

      wizardScene.onCallbackQuery(
        filters.equals('CANCEL'),
        async (upd, state) => {
          console.log('Cancel callback query', upd);
          await upd.answer({});

          await upd.editMessage({
            text: 'Действие отменено',
          });

          await state.exit();

          return PropagationAction.ToScene;
        },
      );

      // Pinpad digit handlers
      wizardScene.onCallbackQuery(PinpadDigit.filter(), async (upd, state) => {
        console.log('Pinpad digit', upd);
        const { digit } = PinpadDigit.parse(Buffer.from(upd.data!).toString());
        const currentState = (await state.get()) as AddAccountState;
        const currentCode = currentState.phoneCode || '';

        if (currentCode.length < 10) {
          // Limit code length to 10 digits
          const newCode = currentCode + digit;
          await state.merge({ phoneCode: newCode });

          const codeDisplay = newCode || '(не введен)';
          await upd.editMessage({
            text: `Введи код из СМС:\n\nКод: ${codeDisplay}`,
            replyMarkup: createPinpadKeyboard(newCode),
          });
        }

        await upd.answer({});
        return PropagationAction.Continue;
      });

      // Pinpad action handlers
      wizardScene.onCallbackQuery(PinpadAction.filter(), async (upd, state) => {
        console.log('Pinpad action', upd);
        const { action } = PinpadAction.parse(
          Buffer.from(upd.data!).toString(),
        );
        const currentState = (await state.get()) as AddAccountState;
        const currentCode = currentState.phoneCode || '';

        if (action === 'clear') {
          await state.merge({ phoneCode: '' });
          await upd.editMessage({
            text: 'Введи код из СМС:\n\nКод: (не введен)',
            replyMarkup: createPinpadKeyboard(''),
          });
        } else if (action === 'backspace') {
          const newCode = currentCode.slice(0, -1);
          await state.merge({ phoneCode: newCode });

          const codeDisplay = newCode || '(не введен)';
          await upd.editMessage({
            text: `Введи код из СМС:\n\nКод: ${codeDisplay}`,
            replyMarkup: createPinpadKeyboard(newCode),
          });
        } else if (action === 'submit') {
          const { name, phone } = currentState;
          const phoneCode = currentCode;

          if (!phoneCode || phoneCode.length < 4) {
            await upd.answer({
              text: 'Код должен содержать минимум 4 цифры',
              alert: true,
            });
            return PropagationAction.Continue;
          }

          await upd.editMessage({
            text: `Проверяем код: ${phoneCode}...`,
          });

          try {
            await this.confirmAccountByPhone(phone!, phoneCode);

            await upd.editMessage({
              text: 'Аккаунт успешно добавлен! ✅',
            });

            await state.exit();
            return PropagationAction.Continue;
          } catch (error) {
            await upd.editMessage({
              text: `Ошибка при добавлении аккаунта: ${error.message}\n\nПопробуйте ввести код еще раз:`,
              replyMarkup: createPinpadKeyboard(''),
            });

            await state.merge({ phoneCode: '' });
            return PropagationAction.Continue;
          }
        }

        await upd.answer({});
        return PropagationAction.Continue;
      });

      // Add handler to stop wizard on any command
      wizardScene.onNewMessage(
        (msg) => msg.text?.startsWith('/'),
        async (msg, state) => {
          console.log(
            'Command received while in wizard, stopping wizard:',
            msg.text,
          );

          await msg.answerText(
            'Мастер добавления аккаунта остановлен из-за новой команды.',
          );

          await state.exit();

          return PropagationAction.Stop;
        },
      );

      const botDp = Dispatcher.for<AddAccountState>(this.botClient, {
        storage: new MemoryStateStorage(),
      });

      botDp.addScene(wizardScene);

      // botDp.onNewMessage(async (msg) => {
      //   console.log('New message on bot', msg);
      //   await msg.answerText(
      //     `Hello from bot on server ${process.env.NODE_ID}. Bot token: ${process.env.BOT_TOKEN}. Bot client id: ${JSON.stringify(await this.botClient.getMe())}`,
      //   );
      // });

      botDp.onNewMessage(filters.command('start'), async (msg) => {
        console.log('New message on bot', msg);
        const totalAccounts = await this.telestoryAccountData.find({
          isActive: true,
          type: 'user',
        });

        const workingAccounts = totalAccounts.filter((account) => {
          return account.isActive;
        });

        const notWorkingAccounts = totalAccounts.filter((account) => {
          return !account.isActive;
        });

        const isMasterNode = process.env.IS_MASTER_NODE === 'true';

        await msg.answerText(
          md(
            `🤖 **Telestory Bot** - ${isMasterNode ? 'Мастер нода' : 'Обычная нода'}: ${process.env.NODE_ID}\n\n` +
              `📊 **Доступные команды:**\n` +
              `• /start - Главная информация\n` +
              `• /stats - Показать статистику всех нод\n` +
              `• /add - Добавить аккаунт\n\n` +
              `👥 **Аккаунты на ноде:**\n` +
              `• Работающих: ${workingAccounts.length}\n` +
              `• Не работающих: ${notWorkingAccounts.length}\n\n` +
              (workingAccounts.length > 0
                ? `✅ **Активные аккаунты:**\n${Array.from(workingAccounts)
                    .slice(0, 10) // Limit to first 10
                    .map((account) => {
                      const phoneDisplay = account.phone
                        ? `***${account.phone.slice(-4)}`
                        : 'номер не указан';
                      return `• ${account.name} (${phoneDisplay})`;
                    })
                    .join(
                      '\n',
                    )}\n${workingAccounts.length > 10 ? `• И еще ${workingAccounts.length - 10}...\n` : ''}\n`
                : '') +
              (notWorkingAccounts.length > 0
                ? `❌ **Неактивные аккаунты:**\n${Array.from(notWorkingAccounts)
                    .slice(0, 5) // Limit to first 5
                    .map((account) => {
                      const phoneDisplay = account.phone
                        ? `***${account.phone.slice(-4)}`
                        : 'номер не указан';
                      return `• ${account.name} (${phoneDisplay})`;
                    })
                    .join(
                      '\n',
                    )}\n${notWorkingAccounts.length > 5 ? `• И еще ${notWorkingAccounts.length - 5}...\n` : ''}\n`
                : '') +
              `\n💡 Используйте /stats для детальной статистики!`,
          ),
        );
      });

      botDp.onNewMessage(filters.command('add'), async (msg) => {
        console.log('Service nodes', this.telestoryNodesService.nodes);
        const nodes = Array.from(this.telestoryNodesService.nodes.values());

        await msg.answerText(`Доступные ноды: ${nodes.length}`);

        const nodesKeyboard = nodes.map((node) => {
          return [
            BotKeyboard.callback(
              node.name,
              ChooseNodeButton.build({
                nodeId: node.name,
              }),
            ),
          ];
        });

        await msg.answerText('Выбери ноду', {
          replyMarkup: BotKeyboard.inline(nodesKeyboard),
        });
      });

      // Stats command handler
      botDp.onNewMessage(filters.command('stats'), async (msg) => {
        try {
          await msg.answerText('📊 Получение статистики всех нод...');

          // Always try to get stats for all nodes first
          let statsData;
          try {
            statsData = await this.nodeStatsService.getAllNodesStats();

            let statsMessage = '📊 **Статистика всех нод**\n\n';
            statsMessage += `🔍 **Общая информация:**\n`;
            statsMessage += `• Всего нод: **${statsData.summary.totalNodes}**\n`;
            statsMessage += `• Активных нод: **${statsData.summary.activeNodes}**\n`;
            statsMessage += `• Одобренных нод: **${statsData.summary.approvedNodes}**\n`;
            statsMessage += `• Всего аккаунтов: **${statsData.summary.totalAccounts}**\n`;
            statsMessage += `• Активных аккаунтов: **${statsData.summary.totalActiveAccounts}**\n`;
            statsMessage += `• Запросов за день: **${statsData.summary.totalRequestsLastDay}**\n`;
            statsMessage += `• Использовано диска: **${statsData.summary.totalDiskSpaceUsedFormatted}**\n\n`;

            // Add individual node stats
            for (const node of statsData.nodes) {
              statsMessage += `🖥️ **${node.nodeName}** (\`${node.nodeType}\`)\n`;
              statsMessage += `• IP: \`${node.nodeIp}\`\n`;
              statsMessage += `• Статус: ${node.isActive ? '🟢 Активна' : '🔴 Неактивна'}\n`;
              statsMessage += `• Одобрена: ${node.approvedByMaster ? '✅ Да' : '❌ Нет'}\n`;
              statsMessage += `• Аккаунты: **${node.accountsStats.activeAccounts}**/**${node.accountsStats.totalAccounts}**\n`;
              statsMessage += `• Запросов за день: **${node.requestStats.requestsLastDay}**\n`;
              const usedSpacePercent =
                100 - node.systemStats.freeDiskSpacePercent;
              statsMessage += `• Свободно диска: **${node.systemStats.freeDiskSpacePercent.toFixed(1)}%**\n`;
              statsMessage += `• Диск: **${usedSpacePercent.toFixed(1)}%**/**${node.systemStats.freeDiskSpacePercent.toFixed(1)}%**\n`;
              statsMessage += `• Память: **${node.systemStats.freeMemoryFormatted}**/**${node.systemStats.totalMemoryFormatted}**\n`;
              statsMessage += `• Аптайм: \`${node.systemStats.uptimeFormatted}\`\n\n`;
            }

            statsMessage += `\n🕐 Обновлено: ${new Date(statsData.collectedAt).toLocaleString('ru-RU')}`;

            await msg.answerText(md(statsMessage));
          } catch (allNodesError) {
            // If getting all nodes stats fails, fall back to current node only
            console.warn(
              'Failed to get all nodes stats, falling back to current node:',
              allNodesError.message,
            );

            statsData = await this.nodeStatsService.getCurrentNodeStats();

            let statsMessage = `📊 **Статистика ноды ${statsData.nodeName}**\n\n`;
            statsMessage += `⚠️ **Примечание:** Показана только текущая нода (не удалось получить данные других нод)\n\n`;

            // Show warning if stats collection partially failed
            if (!statsData.statsCollectionSuccess) {
              statsMessage += `⚠️ **Предупреждение:** Некоторые статистики недоступны\n\n`;
            }

            statsMessage += `🖥️ **Информация о ноде:**\n`;
            statsMessage += `• Тип: ${statsData.nodeType === 'premium' ? '⭐ **Premium**' : '🆓 **Free**'}\n`;
            statsMessage += `• IP: \`${statsData.nodeIp}\`\n`;
            statsMessage += `• Статус: ${statsData.isActive ? '🟢 **Активна**' : '🔴 **Неактивна**'}\n`;
            statsMessage += `• Одобрена мастером: ${statsData.approvedByMaster ? '✅ Да' : '❌ Нет'}\n\n`;

            statsMessage += `👥 **Аккаунты:**\n`;
            statsMessage += `• Всего: **${statsData.accountsStats.totalAccounts}**\n`;
            statsMessage += `• Активных: **${statsData.accountsStats.activeAccounts}**\n`;
            statsMessage += `• Неактивных: **${statsData.accountsStats.inactiveAccounts}**\n\n`;

            statsMessage += `📈 **Запросы:**\n`;
            statsMessage += `• За час: **${statsData.requestStats.requestsLastHour}**\n`;
            statsMessage += `• За день: **${statsData.requestStats.requestsLastDay}**\n`;
            statsMessage += `• За неделю: **${statsData.requestStats.requestsLastWeek}**\n`;
            statsMessage += `• За месяц: **${statsData.requestStats.requestsLastMonth}**\n`;
            statsMessage += `• Общий размер загрузок: **${statsData.requestStats.totalDownloadSizeFormatted}**\n\n`;

            statsMessage += `💾 **Система:**\n`;
            const usedSpacePercent =
              100 - statsData.systemStats.freeDiskSpacePercent;
            statsMessage += `• Свободно диска: **${statsData.systemStats.freeDiskSpacePercent.toFixed(1)}%**\n`;
            statsMessage += `• Диск: **${usedSpacePercent.toFixed(1)}%**/**${statsData.systemStats.freeDiskSpacePercent.toFixed(1)}%**\n`;
            statsMessage += `• Память: **${statsData.systemStats.freeMemoryFormatted}**/**${statsData.systemStats.totalMemoryFormatted}**\n`;
            statsMessage += `• Аптайм: \`${statsData.systemStats.uptimeFormatted}\`\n`;
            statsMessage += `• CPU: **${statsData.systemStats.cpus.length}** ядер\n\n`;

            if (statsData.accountsStats.inactiveAccountsDetails.length > 0) {
              statsMessage += `❌ **Неактивные аккаунты:**\n`;
              for (const account of statsData.accountsStats.inactiveAccountsDetails.slice(
                0,
                5,
              )) {
                statsMessage += `• **${account.name}**: \`${account.reason}\`\n`;
              }
              if (statsData.accountsStats.inactiveAccountsDetails.length > 5) {
                statsMessage += `• И еще **${statsData.accountsStats.inactiveAccountsDetails.length - 5}**...\n`;
              }
              statsMessage += '\n';
            }

            statsMessage += `🕐 Обновлено: ${new Date().toLocaleString('ru-RU')}`;

            await msg.answerText(md(statsMessage));
          }
        } catch (error) {
          console.error('Error getting node stats:', error);
          await msg.answerText(
            md(`❌ **Ошибка при получении статистики:** ${error.message}`),
          );
        }
      });

      botDp.onCallbackQuery(ChooseNodeButton.filter(), async (query, state) => {
        query.answer({});
        await state.enter(wizardScene);

        await query.editMessage({
          text: 'Введи имя аккаунта',
          replyMarkup: BotKeyboard.inline([
            [BotKeyboard.callback('Cancel', 'CANCEL')],
          ]),
        });

        return PropagationAction.ToScene;
      });
    }

    this.initialized = true;
  }

  async addAccountByPhone(name: string, phone: string) {
    // Normalize the phone number to E.164 format for consistency
    const normalizedPhone = PhoneUtils.normalize(phone);

    const tg = new TelegramClient({
      apiId: Number(process.env.API_ID),
      apiHash: process.env.API_HASH!,
      storage: `temp-${normalizedPhone}`,
    });

    console.log('Send code request', phone, normalizedPhone, {
      phone: normalizedPhone,
    });

    const code = (await tg.sendCode({ phone: normalizedPhone })) as SentCode;

    console.log('Sent code response', code);

    const phoneCodeHash = code.phoneCodeHash;

    const bindNodeId = process.env.NODE_ID!;

    const session = await tg.exportSession();

    // Use upsert to create or update pending account in a single atomic operation
    await this.telestoryPendingAccountData.updateOne(
      { phone: normalizedPhone },
      {
        $set: {
          sessionData: session,
          name,
          bindNodeId,
          phoneCodeHash,
          phone: normalizedPhone,
        },
        $setOnInsert: {
          type: 'user', // Only set default type on insert
        },
      },
      { upsert: true },
    );
  }

  async confirmAccountByPhone(phone: string, phoneCode: string) {
    // Normalize the phone number to ensure consistency with stored data
    const normalizedPhone = PhoneUtils.normalize(phone);

    const pendingAccount = await this.telestoryPendingAccountData.findOne({
      phone: normalizedPhone,
    });

    if (!pendingAccount) {
      throw new Error('Pending account not found');
    }

    const tg = new TelegramClient({
      apiId: Number(process.env.API_ID),
      apiHash: process.env.API_HASH!,
      storage: `temp-${normalizedPhone}`,
    });

    // await tg.importSession(pendingAccount.sessionData);

    try {
      console.log(
        'Signing in',
        normalizedPhone,
        pendingAccount.phoneCodeHash,
        phoneCode,
      );
      await tg.signIn({
        phone: normalizedPhone,
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
      phone: normalizedPhone,
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
