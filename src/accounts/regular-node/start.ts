/* eslint-disable no-console */

import type { ITelegramClient } from '@mtcute/core';
import type { SentCode } from '@mtcute/core';
import type { MaybeDynamic } from '@mtcute/core';
import type { InputStringSessionData } from '@mtcute/core/utils';
import { tl } from '@mtcute/tl';
import { MtArgumentError, MtcuteError } from '@mtcute/core';
import { User } from '@mtcute/core';
// import { normalizePhoneNumber, resolveMaybeDynamic } from '@mtcute/core/utils'
import { TelegramClient } from '@mtcute/node';
import * as fs from 'fs-extra';

import { PhoneUtils } from '../../common/utils/phone.utils';

import { MaybePromise } from '@mtcute/core/types';

// @available=both
/**
 * Start the client in an interactive and declarative manner,
 * by providing callbacks for authorization details.
 *
 * This method handles both login and sign up, and also handles 2FV
 *
 * All parameters are `MaybeDynamic<T>`, meaning you
 * can either supply `T`, or a function that returns `MaybePromise<T>`
 *
 * This method is intended for simple and fast use in automated
 * scripts and bots. If you are developing a custom client,
 * you'll probably need to use other auth methods.
 */
export async function start(
  client: TelegramClient,
  params: {
    /**
     * String session exported using {@link TelegramClient.exportSession}.
     *
     * This simply calls {@link TelegramClient.importSession} before anything else.
     *
     * Note that passed session will be ignored in case storage already
     * contains authorization.
     */
    session?: string | InputStringSessionData;

    /**
     * Whether to overwrite existing session.
     */
    sessionForce?: boolean;

    /**
     * When passed, [QR login flow](https://core.telegram.org/api/qr-login)
     * will be used instead of the regular login flow.
     *
     * This function will be called whenever the login URL is changed,
     * and the app is expected to display it as a QR code to the user.
     */
    qrCodeHandler?: (url: string, expires: Date) => void;

    /**
     * Phone number of the account.
     * If account does not exist, it will be created
     */
    phone?: MaybeDynamic<string>;

    /**
     * Bot token to use. Ignored if `phone` is supplied.
     */
    botToken?: MaybeDynamic<string>;

    /**
     * 2FA password. Ignored if `botToken` is supplied
     */
    password?: MaybeDynamic<string>;

    /**
     * Code sent to the phone (either sms, call, flash call or other).
     * Ignored if `botToken` is supplied, must be present if `phone` is supplied.
     */
    code?: MaybeDynamic<string>;

    /**
     * If passed, this function will be called if provided code or 2FA password
     * was invalid. New code/password will be requested later.
     *
     * If provided `code`/`password` is a constant string, providing an
     * invalid one will interrupt authorization flow.
     */
    invalidCodeCallback?: (type: 'code' | 'password') => MaybePromise<void>;

    /**
     * Whether to force code delivery through SMS
     */
    forceSms?: boolean;

    /**
     * Custom method that is called when a code is sent. Can be used
     * to show a GUI alert of some kind.
     *
     * This method is called *before* {@link start.params.code}.
     *
     * @param code
     * @default  `console.log`.
     */
    codeSentCallback?: (code: SentCode) => MaybePromise<void>;

    /** Saved future auth tokens, if any */
    futureAuthTokens?: Uint8Array[];

    /** Additional code settings to pass to the server */
    codeSettings?: Omit<tl.RawCodeSettings, '_' | 'logoutTokens'>;

    /** Abort signal */
    abortSignal?: AbortSignal;
  },
): Promise<User> {
  if (params.session) {
    await client.importSession(params.session, params.sessionForce);
  }

  const { abortSignal } = params;

  let has2fa = false;
  let sentCode: SentCode | undefined;
  let phone: string | null = null;

  try {
    const me = await client.getMe();

    // user is already authorized

    client.log.info(
      'Logged in as %s (ID: %s, username: %s, bot: %s)',
      me.displayName,
      me.id,
      me.username,
      me.isBot,
    );

    await client.notifyLoggedIn(me.raw);

    return me;
  } catch (e) {
    if (tl.RpcError.is(e)) {
      if (e.text === 'SESSION_PASSWORD_NEEDED') {
        has2fa = true;
      } else if (
        e.text === 'SESSION_REVOKED' ||
        e.text === 'USER_DEACTIVATED' ||
        e.text === 'USER_DEACTIVATED_BAN'
      ) {
        // session is dead, we need to explicitly log out before we can log in again
        // await logOut(client).catch((err) => {
        //     client.log.warn('failed to log out: %e', err)
        // })
      } else if (e.text !== 'AUTH_KEY_UNREGISTERED') {
        throw e;
      }
    } else {
      throw e;
    }
    throw e;
  }
}

const models = JSON.parse(
  fs.readFileSync('./src/accounts/regular-node/devices.json', 'utf8'),
);

const devices = models.map(
  (x: any) => x['properties']['$brand'] + ' ' + x['properties']['$model'],
);

export function getInitConnectionOptions() {
  return {
    appVersion: 'Telegram Android 9.7.4',
    deviceModel: devices[Math.floor(Math.random() * devices.length)],
    systemVersion: 'SDK 29',
    systemLangCode: 'ru',
    langPack: 'android',
    params: {
      _: 'jsonObject',
      value: [
        {
          _: 'jsonObjectValue',
          key: 'device_token',
          value: { _: 'jsonString', value: 'NO_GOOGLE_PLAY_SERVICES' },
        },
        {
          _: 'jsonObjectValue',
          key: 'data',
          value: {
            _: 'jsonString',
            value:
              'C1522548EBACD46CE322B6FD47F6092BB745D0F88082145CAF35E14DCC38E1',
          },
        },
        {
          _: 'jsonObjectValue',
          key: 'installer',
          value: { _: 'jsonString', value: 'com.android.vending' },
        },
        {
          _: 'jsonObjectValue',
          key: 'package_id',
          value: { _: 'jsonString', value: 'org.telegram.messenger' },
        },
        {
          _: 'jsonObjectValue',
          key: 'tz_offset',
          value: { _: 'jsonNumber', value: 3 * 60 * 60 },
        },
        {
          _: 'jsonObjectValue',
          key: 'perf_cat',
          value: { _: 'jsonNumber', value: 1 },
        },
      ],
    },
  };
}
