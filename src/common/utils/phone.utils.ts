import { MtArgumentError } from '@mtcute/core';
import { parsePhoneNumber, PhoneNumber, CountryCode } from 'libphonenumber-js';

export class PhoneUtils {
  /**
   * Normalizes phone number for storage (removes all formatting, keeps only digits with +)
   * This is useful for consistent storage and comparison
   * @param phoneNumber - Raw phone number string
   * @param defaultCountry - Default country code if not specified in number (defaults to 'RU')
   * @returns Normalized phone number in E.164 format
   */
  static normalize(phoneNumber: string, defaultCountry?: CountryCode): string {
    const phone = phoneNumber.trim().replace(/[+()\s-]/g, '');
    if (!phone.match(/^\d+$/)) throw new MtArgumentError('Invalid phone number');
    return phone;
  }
}
