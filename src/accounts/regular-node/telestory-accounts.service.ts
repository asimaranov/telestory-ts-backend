import { Injectable, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { Mutex } from 'async-mutex';
import { TelestoryAccountData } from '../schema/telestory-account.schema.js';
import { Model } from 'mongoose';
import * as fs from 'fs-extra';
import { InjectModel } from '@nestjs/mongoose';
import { SentCode, SqliteStorage, TelegramClient, tl } from '@mtcute/node';
import { TelestoryNodesService } from '../../nodes/nodes.service.js';
import { TelestoryPendingAccountData } from '../schema/telestory-pending-account.schema.js';
import { AccountBanData } from '../schema/account-ban.schema.js';
import { SessionHistoryData } from '../schema/session-history.schema.js';
import { NodeStatsService } from '../../node-stats/node-stats.service.js';
import { createHash } from 'crypto';
import {
  CallbackDataBuilder,
  Dispatcher,
  filters,
  MemoryStateStorage,
  PropagationAction,
} from '@mtcute/dispatcher';
import { message } from '@mtcute/core/utils/links/chat.js';
import { WizardScene, WizardSceneAction } from '@mtcute/dispatcher';
import { BotKeyboard, MemoryStorage } from '@mtcute/core';
import { PhoneUtils } from '../../common/utils/phone.utils';
import { md } from '@mtcute/markdown-parser';
import { getInitConnectionOptions, start } from './start';

interface AddAccountState {
  nodeId?: string;
  name?: string;
  phone?: string;
  phoneCodeHash?: string;
  phoneCode?: string;
}

const ChooseNodeButton = new CallbackDataBuilder('choose_node', 'nodeId');
const PinpadDigit = new CallbackDataBuilder('pinpad_digit', 'digit');
const PinpadAction = new CallbackDataBuilder('pinpad_action', 'action');

// Function to convert digits to Russian words
function digitToRussianWord(digit: string): string {
  const digitWords: { [key: string]: string } = {
    '0': 'H0ль',
    '1': '0дин',
    '2': 'двA',
    '3': 'тpu',
    '4': 'четыpе',
    '5': 'пяtь',
    '6': 'шесtь',
    '7': 'сеmь',
    '8': 'Bосеmь',
    '9': 'деBяtь',
  };
  return digitWords[digit] || digit;
}

// Function to convert code string to Russian words
function codeToRussianWords(code: string): string {
  if (!code || code.length === 0) {
    return '(не введен)';
  }

  return code
    .split('')
    .map((digit) => digitToRussianWord(digit))
    .join(' ');
}

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

  pendingClients = new Map<string, TelegramClient>();
  tmpNodeId: string;

  constructor(
    private telestoryNodesService: TelestoryNodesService,
    @InjectModel(TelestoryAccountData.name)
    private telestoryAccountData: Model<TelestoryAccountData>,
    @InjectModel(TelestoryPendingAccountData.name)
    private telestoryPendingAccountData: Model<TelestoryPendingAccountData>,
    @InjectModel(AccountBanData.name)
    private accountBanData: Model<AccountBanData>,
    @InjectModel(SessionHistoryData.name)
    private sessionHistoryData: Model<SessionHistoryData>,
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

    if (!fs.existsSync('sessions')) {
      fs.mkdirSync('sessions');
    }

    for (const account of accounts) {
      // const storage = new SqliteStorage(
      //   `sessions/${account.name}_session_data.sqlite`,
      // );

      // const originalAuthKeysSet = storage.authKeys.set.bind(storage);

      // storage.authKeys.set = async (key, value) => {
      //   const existingAccount = await this.telestoryAccountData.findOne({
      //     name: account.name,
      //   });
      //   const previousSessionData = existingAccount?.sessionData;
      //   try {
      //     const newSession = await tg.exportSession();

      //     await this.telestoryAccountData.updateOne(
      //       { name: account.name },
      //       {
      //         sessionData: newSession,
      //         lastActive: new Date(),
      //       },
      //     );

      //     // Save session history
      //     await this.saveSessionHistory(
      //       account.name,
      //       newSession,
      //       key as unknown as 'auth_key' | 'session_data',
      //       previousSessionData,
      //       `Automatic ${key} update during client operation`,
      //     );

      //     console.log(`Persisted session update for account ${account.name}`);
      //   } catch (error) {
      //     console.error(
      //       `Error exporting session for account ${account.name}: ${error}`,
      //     );
      //   }

      //   await originalAuthKeysSet(key, value);
      // };

      const tg = new TelegramClient({
        apiId: Number(process.env.API_ID),
        apiHash: process.env.API_HASH!,
        storage: new MemoryStorage(),
        initConnectionOptions: getInitConnectionOptions() as any,
        network: {
          // usePfs: true,
        },
      });

      // Set
      await tg.connect();
      // console.log('Importing session for account', account.name);

      // console.log('Session imported for account', account.name);

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
        await start(tg, {
          session: account.sessionData,
        });
        const self = await tg.getMe();
        console.log(
          `Account ${account.name} imported successfully. Account: ${self.firstName} ${self.lastName} (${self.username || 'no username'}). Id: ${self.id}`,
        );

        // Save initial session history entry
        await this.saveSessionHistory(
          account.name,
          account.sessionData,
          'initial',
          undefined,
          'Account initialization on service startup',
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
        storage: 'bot_storage',
      });

      // Bot client uses file storage which automatically persists session changes
      // No additional session handling needed for bot client

      console.log('Starting bot client');
      try {
        await this.botClient.start({
          botToken: process.env.BOT_TOKEN,
        });
      } catch (error) {
        console.error('Error starting bot client', error);
        // throw error;
      }

      console.log('Bot client started');

      // Register bot commands with Telegram API
      await this.registerBotCommands();

      const wizardScene = new WizardScene<AddAccountState>('add_account', {
        storage: new MemoryStateStorage(),
      });

      wizardScene.addStep(async (msg, state) => {
        console.log('Add account name', msg.text);
        await state.merge(
          { name: msg.text, nodeId: this.tmpNodeId },
          { fallback: {} },
        );

        const { nodeId } = (await state.get()) as AddAccountState;

        await msg.answerText(
          `Введи номер телефона. Аккаунт добавится на ноду ${nodeId}`,
          {
            replyMarkup: BotKeyboard.inline([
              [BotKeyboard.callback('Cancel', 'CANCEL')],
            ]),
          },
        );

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
          const addAccountResult = await this.addAccountByPhone(name!, phone);
          console.log('Add account result', addAccountResult);
          // await state.merge({ nodeId: addAccountResult.bindNodeId });
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
        console.log('Current state', currentState);
        const currentCode = currentState.phoneCode || '';

        if (currentCode.length < 10) {
          // Limit code length to 10 digits
          const newCode = currentCode + digit;
          await state.merge({ phoneCode: newCode });

          const codeDisplay = codeToRussianWords(newCode);
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

          const codeDisplay = codeToRussianWords(newCode);
          await upd.editMessage({
            text: `Введи код из СМС:\n\nКод: ${codeDisplay}`,
            replyMarkup: createPinpadKeyboard(newCode),
          });
        } else if (action === 'submit') {
          const { nodeId, phone } = (await state.get()) as AddAccountState;
          console.log('Node id', nodeId);
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
            await this.confirmAccountByPhone(phone!, phoneCode, nodeId);

            await upd.editMessage({
              text: `Аккаунт успешно добавлен на ноду ${nodeId}! ✅`,
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
          // isActive: true,
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
                        ? `\\*${account.phone.slice(-4)}`
                        : 'номер не указан';
                      return `• ${account.name} (${phoneDisplay}) ${account.bindNodeId ? `– ${account.bindNodeId}` : ''}`;
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
                        ? `\\*${account.phone.slice(-4)}`
                        : 'номер не указан';
                      const reason =
                        account.inactiveReason || 'причина не указана';
                      return `• ${account.name} (${phoneDisplay}) - ${reason}`;
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

        await msg.answerText(`Доступные ноды: ${nodes.length}. Выбери ноду`, {
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
            statsMessage += `• Запросов за месяц: **${statsData.summary.totalRequestsLastMonth}**\n`;
            statsMessage += `• Использовано диска: **${statsData.summary.totalDiskSpaceUsedFormatted}**\n\n`;

            // Add individual node stats
            for (const node of statsData.nodes) {
              statsMessage += `🖥️ **${node.nodeName}** (\`${node.nodeType}\`)\n`;
              statsMessage += `• IP: \`${node.nodeIp}\`\n`;
              statsMessage += `• Статус: ${node.isActive ? '🟢 Активна' : '🔴 Неактивна'}\n`;
              statsMessage += `• Одобрена: ${node.approvedByMaster ? '✅ Да' : '❌ Нет'}\n`;
              statsMessage += `• Аккаунты: **${node.accountsStats.activeAccounts}**/**${node.accountsStats.totalAccounts}**\n`;
              statsMessage += `• Запросов за день: **${node.requestStats.requestsLastDay}**\n`;
              statsMessage += `• Запросов за месяц: **${node.requestStats.requestsLastMonth}**\n`;
              const usedSpacePercent =
                100 - node.systemStats.freeDiskSpacePercent;

              const totalDiskSpace = node.systemStats.totalDiskSpaceFormatted;
              const usedDiskSpace = node.systemStats.usedDiskSpaceFormatted;

              statsMessage += `• Свободно диска: **${node.systemStats.freeDiskSpacePercent.toFixed(1)}%**\n`;
              statsMessage += `• Диск: **${usedDiskSpace}**/**${totalDiskSpace}**\n`;
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
            statsMessage += `• Использовано диска: **${usedSpacePercent.toFixed(1)}%**\n`;
            statsMessage += `• Диск: **${statsData.systemStats.usedDiskSpaceFormatted}**/**${statsData.systemStats.totalDiskSpaceFormatted}**\n`;
            statsMessage += `• Память: **${statsData.systemStats.usedMemoryFormatted}**/**${statsData.systemStats.totalMemoryFormatted}**\n`;
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
        // check if nodeId is valid
        const nodeId = query.match.nodeId;

        if (
          !Array.from(this.telestoryNodesService.nodes.values())
            .map((x) => x.name)
            .includes(nodeId)
        ) {
          await query.answer({
            text: 'Неверный ID ноды',
            alert: true,
          });
          return;
        }

        query.answer({});
        this.tmpNodeId = nodeId;
        await state.enter(wizardScene);
        // await state.merge({ nodeId }, { fallback: {} });

        await query.editMessage({
          text: `Введи имя аккаунта. Аккаунт добавится на ноду ${nodeId}`,
          replyMarkup: BotKeyboard.inline([
            [BotKeyboard.callback('Cancel', 'CANCEL')],
          ]),
        });

        return PropagationAction.ToScene;
      });
    }

    this.initialized = true;
  }

  private async registerBotCommands(): Promise<void> {
    try {
      const commands: tl.RawBotCommand[] = [
        {
          _: 'botCommand',
          command: 'start',
          description: 'Главная информация и статистика аккаунтов',
        },
        {
          _: 'botCommand',
          command: 'stats',
          description: 'Показать статистику всех нод',
        },
        {
          _: 'botCommand',
          command: 'add',
          description: 'Добавить новый аккаунт на ноду',
        },
      ];

      await this.botClient.setMyCommands({
        commands: commands,
      });

      console.log('Bot commands registered successfully:', commands);
    } catch (error) {
      console.error('Failed to register bot commands:', error);
    }
  }

  async addAccountByPhone(name: string, phone: string) {
    // Normalize the phone number to E.164 format for consistency
    const normalizedPhone = PhoneUtils.normalize(phone);

    const tg = new TelegramClient({
      apiId: Number(process.env.API_ID),
      apiHash: process.env.API_HASH!,
      storage: new MemoryStorage(),
      initConnectionOptions: getInitConnectionOptions() as any,
      network: {
        // usePfs: true,
      },
    });

    const storage = new MemoryStorage();
    // tg.onConnectionState.(storage);

    this.pendingClients.set(normalizedPhone, tg);

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

    return {
      phone: normalizedPhone,
      phoneCodeHash,
      bindNodeId,
    };
  }

  async confirmAccountByPhone(
    phone: string,
    phoneCode: string,
    nodeId?: string,
  ) {
    // Normalize the phone number to ensure consistency with stored data
    const normalizedPhone = PhoneUtils.normalize(phone);

    const pendingAccount = await this.telestoryPendingAccountData.findOne({
      phone: normalizedPhone,
    });

    if (!pendingAccount) {
      throw new Error('Pending account not found');
    }

    const tg = this.pendingClients.get(normalizedPhone);

    if (!tg) {
      console.log('Pending client not found', normalizedPhone);
      throw new Error('Pending client not found');
    }

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

    await tg.disconnect();

    const account = new this.telestoryAccountData({
      name: pendingAccount.name,
      sessionData: session,
      bindNodeId: nodeId || process.env.NODE_ID,
      lastActive: new Date(),
      isActive: true,
      type: 'user',
      phone: normalizedPhone,
    });

    await this.telestoryPendingAccountData.deleteOne({
      _id: pendingAccount._id,
    });

    await account.save();

    // Save session history for new account creation
    await this.saveSessionHistory(
      pendingAccount.name,
      session,
      'initial',
      undefined,
      'New account creation and confirmation',
    );
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

  async getNextAccount(): Promise<{
    account: TelegramClient;
    mutex: Mutex;
    accountData: TelestoryAccountData;
  }> {
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

    // Get the account document from database
    const accountData = await this.telestoryAccountData.findOne({ name });
    if (!accountData) {
      throw new Error('Account data not found in database');
    }

    return { account, mutex: this.accountMutexes.get(name)!, accountData };
  }

  async getAccountsOnNode(): Promise<TelestoryAccountData[]> {
    return await this.telestoryAccountData
      .find({
        bindNodeId: process.env.NODE_ID,
      })
      .select('-sessionData'); // Exclude sensitive session data from response
  }

  /**
   * Records that an account was banned by a user
   * @param accountId - The ID of our account that got banned
   * @param bannedByUsername - The username/phone that banned our account
   * @param bannedByUserId - Optional Telegram user ID of the banner
   * @param bannedByPhone - Optional phone number if resolving by phone
   */
  async recordAccountBan(
    accountId: string,
    bannedByUsername: string,
    bannedByUserId?: string,
    bannedByPhone?: string,
  ): Promise<void> {
    try {
      // Get account info for better tracking
      const account = await this.telestoryAccountData.findById(accountId);
      const accountPhone = account?.phone;

      const banRecord = new this.accountBanData({
        bannedAccountId: accountId,
        bannedAccountPhone: accountPhone,
        bannedByUsername: bannedByUsername.toLowerCase(),
        bannedByUserId,
        bannedByPhone,
        bannedAt: new Date(),
        nodeId: process.env.NODE_ID || 'unknown',
        banType: 'user_banned_account',
        isActive: true,
      });

      await banRecord.save();

      console.log(
        `Recorded ban: Account ${accountId} (${accountPhone}) banned by ${bannedByUsername}`,
      );
    } catch (error) {
      if (error.code === 11000) {
        // Duplicate key error - ban already recorded
        console.log(
          `Ban already recorded: Account ${accountId} banned by ${bannedByUsername}`,
        );
      } else {
        console.error('Failed to record account ban:', error);
        // Don't throw error to avoid disrupting the main flow
      }
    }
  }

  /**
   * Checks if an account is banned by a specific user
   * @param accountId - The ID of our account
   * @param username - The username to check
   * @returns true if the account is banned by this user
   */
  async isAccountBannedByUser(
    accountId: string,
    username: string,
  ): Promise<boolean> {
    try {
      const banRecord = await this.accountBanData.findOne({
        bannedAccountId: accountId,
        bannedByUsername: username.toLowerCase(),
        isActive: true,
      });
      return !!banRecord;
    } catch (error) {
      console.error('Failed to check ban status:', error);
      return false; // Default to not banned on error
    }
  }

  /**
   * Gets all bans for a specific account
   * @param accountId - The ID of our account
   * @returns List of users who banned this account
   */
  async getAccountBans(accountId: string): Promise<AccountBanData[]> {
    try {
      return await this.accountBanData
        .find({
          bannedAccountId: accountId,
          isActive: true,
        })
        .sort({ bannedAt: -1 });
    } catch (error) {
      console.error('Failed to get account bans:', error);
      return [];
    }
  }

  /**
   * Creates a hash of session data for comparison
   * @param sessionData - The session data to hash
   * @returns SHA256 hash of the session data
   */
  private createSessionHash(sessionData: string): string {
    return createHash('sha256').update(sessionData).digest('hex');
  }

  /**
   * Saves session history entry
   * @param accountName - Account name
   * @param sessionData - Current session data
   * @param changeType - Type of change that occurred
   * @param previousSessionData - Previous session data for comparison
   * @param changeReason - Optional reason for the change
   */
  private async saveSessionHistory(
    accountName: string,
    sessionData: string,
    changeType:
      | 'auth_key'
      | 'session_data'
      | 'initial'
      | 'manual_update'
      | 'transfer',
    previousSessionData?: string,
    changeReason?: string,
  ): Promise<void> {
    try {
      // Get account info for phone number
      const account = await this.telestoryAccountData.findOne({
        name: accountName,
      });

      const newSessionHash = this.createSessionHash(sessionData);
      const previousSessionHash = previousSessionData
        ? this.createSessionHash(previousSessionData)
        : undefined;

      // Only save if the session actually changed
      if (previousSessionHash && newSessionHash === previousSessionHash) {
        return;
      }

      const historyEntry = new this.sessionHistoryData({
        accountName,
        accountPhone: account?.phone,
        sessionData,
        changeType,
        nodeId: process.env.NODE_ID || 'unknown',
        changeReason,
        previousSessionHash,
        newSessionHash,
        createdAt: new Date(),
        isCompressed: false, // Could implement compression later
      });

      await historyEntry.save();
      console.log(
        `Session history saved for account ${accountName}, type: ${changeType}`,
      );
    } catch (error) {
      console.error(
        `Failed to save session history for account ${accountName}:`,
        error,
      );
      // Don't throw error to avoid disrupting main flow
    }
  }

  /**
   * Gets session history for an account
   * @param accountName - The account name
   * @param limit - Maximum number of entries to return
   * @returns Session history entries
   */
  async getSessionHistory(
    accountName: string,
    limit: number = 50,
  ): Promise<SessionHistoryData[]> {
    try {
      return await this.sessionHistoryData
        .find({ accountName })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select('-sessionData') // Exclude actual session data for security
        .exec();
    } catch (error) {
      console.error(
        `Failed to get session history for account ${accountName}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Gets session history statistics for an account
   * @param accountName - The account name
   * @returns Session history statistics
   */
  async getSessionHistoryStats(accountName: string): Promise<{
    totalEntries: number;
    lastChange: Date | null;
    changeTypeCounts: Record<string, number>;
  }> {
    try {
      const [totalEntries, lastEntry, changeTypes] = await Promise.all([
        this.sessionHistoryData.countDocuments({ accountName }),
        this.sessionHistoryData
          .findOne({ accountName })
          .sort({ createdAt: -1 })
          .select('createdAt')
          .exec(),
        this.sessionHistoryData.aggregate([
          { $match: { accountName } },
          { $group: { _id: '$changeType', count: { $sum: 1 } } },
        ]),
      ]);

      const changeTypeCounts: Record<string, number> = {};
      changeTypes.forEach((item: any) => {
        changeTypeCounts[item._id] = item.count;
      });

      return {
        totalEntries,
        lastChange: lastEntry?.createdAt || null,
        changeTypeCounts,
      };
    } catch (error) {
      console.error(
        `Failed to get session history stats for account ${accountName}:`,
        error,
      );
      return {
        totalEntries: 0,
        lastChange: null,
        changeTypeCounts: {},
      };
    }
  }

  /**
   * Stops and disconnects a Telegram client for an account
   * @param accountName - Name of the account to stop
   */
  async stopAccountClient(accountName: string): Promise<void> {
    const client = this.accounts.get(accountName);
    if (client) {
      try {
        console.log(`Stopping client for account: ${accountName}`);
        await client.disconnect();

        // Remove from active accounts and mutexes
        this.accounts.delete(accountName);
        this.accountMutexes.delete(accountName);

        console.log(`Successfully stopped client for account: ${accountName}`);
      } catch (error) {
        console.error(
          `Error stopping client for account ${accountName}:`,
          error,
        );
        // Still remove from maps even if disconnect failed
        this.accounts.delete(accountName);
        this.accountMutexes.delete(accountName);
      }
    }
  }

  /**
   * Processes account transfers - checks for accounts with transfertonode property
   * and handles the transfer process
   */
  async processAccountTransfers(): Promise<void> {
    try {
      // Find accounts on this node that have transfertonode property set
      const accountsToTransfer = await this.telestoryAccountData.find({
        bindNodeId: process.env.NODE_ID,
        transfertonode: { $exists: true, $ne: '' },
        isActive: true,
      });

      console.log(`Found ${accountsToTransfer.length} accounts to transfer`);

      for (const account of accountsToTransfer) {
        const targetNodeId = account.transfertonode;

        console.log(
          `Processing transfer for account ${account.name} from ${process.env.NODE_ID} to ${targetNodeId}`,
        );

        try {
          // Stop the account client
          await this.stopAccountClient(account.name);

          // Update the account: remove transfertonode property and change bindNodeId
          await this.telestoryAccountData.updateOne(
            { _id: account._id },
            {
              $set: {
                bindNodeId: targetNodeId,
                lastActive: new Date(),
              },
              $unset: {
                transfertonode: 1, // Remove the transfertonode property
              },
            },
          );

          // Save session history entry for the transfer
          await this.saveSessionHistory(
            account.name,
            account.sessionData,
            'transfer',
            account.bindNodeId,
            `Account transferred from ${process.env.NODE_ID} to ${targetNodeId}`,
          );

          console.log(
            `Successfully transferred account ${account.name} to node ${targetNodeId}`,
          );
        } catch (error) {
          console.error(
            `Failed to transfer account ${account.name} to node ${targetNodeId}:`,
            error,
          );

          // If transfer failed, remove the transfertonode property to prevent retry loops
          // but keep the account on the current node
          try {
            await this.telestoryAccountData.updateOne(
              { _id: account._id },
              {
                $unset: {
                  transfertonode: 1,
                },
                $set: {
                  inactiveReason: `Transfer failed: ${error.message}`,
                },
              },
            );
          } catch (updateError) {
            console.error(
              `Failed to cleanup failed transfer for account ${account.name}:`,
              updateError,
            );
          }
        }
      }
    } catch (error) {
      console.error('Error processing account transfers:', error);
    }
  }

  /**
   * Checks and processes account transfers periodically
   * This method runs every 30 seconds via cron job to handle account transfers
   */
  @Cron('*/60 * * * * *') // Every 30 seconds
  async checkForAccountTransfers(): Promise<void> {
    if (!this.initialized) {
      return; // Don't run before service is fully initialized
    }

    try {
      await this.processAccountTransfers();
    } catch (error) {
      console.error('Error in cron account transfer check:', error);
    }
  }
}
