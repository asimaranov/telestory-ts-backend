import { parsePhoneNumber, PhoneNumber, CountryCode } from 'libphonenumber-js';

export class PhoneUtils {
  /**
   * Formats a phone number to international format (E.164)
   * @param phoneNumber - Raw phone number string
   * @param defaultCountry - Default country code if not specified in number
   * @returns Formatted phone number in E.164 format (+1234567890)
   */
  static formatToE164(
    phoneNumber: string,
    defaultCountry?: CountryCode,
  ): string {
    try {
      const parsed = parsePhoneNumber(phoneNumber, defaultCountry);
      if (!parsed || !parsed.isValid()) {
        throw new Error('Invalid phone number');
      }
      return parsed.format('E.164');
    } catch (error) {
      throw new Error(`Phone number formatting failed: ${error.message}`);
    }
  }

  /**
   * Formats a phone number to international format with spaces
   * @param phoneNumber - Raw phone number string
   * @param defaultCountry - Default country code if not specified in number
   * @returns Formatted phone number in international format (+1 234 567 890)
   */
  static formatToInternational(
    phoneNumber: string,
    defaultCountry?: CountryCode,
  ): string {
    try {
      const parsed = parsePhoneNumber(phoneNumber, defaultCountry);
      if (!parsed || !parsed.isValid()) {
        throw new Error('Invalid phone number');
      }
      return parsed.formatInternational();
    } catch (error) {
      throw new Error(`Phone number formatting failed: ${error.message}`);
    }
  }

  /**
   * Formats a phone number to national format
   * @param phoneNumber - Raw phone number string
   * @param defaultCountry - Default country code if not specified in number
   * @returns Formatted phone number in national format (234) 567-890
   */
  static formatToNational(
    phoneNumber: string,
    defaultCountry?: CountryCode,
  ): string {
    try {
      const parsed = parsePhoneNumber(phoneNumber, defaultCountry);
      if (!parsed || !parsed.isValid()) {
        throw new Error('Invalid phone number');
      }
      return parsed.formatNational();
    } catch (error) {
      throw new Error(`Phone number formatting failed: ${error.message}`);
    }
  }

  /**
   * Validates if a phone number is valid
   * @param phoneNumber - Raw phone number string
   * @param defaultCountry - Default country code if not specified in number
   * @returns true if valid, false otherwise
   */
  static isValid(phoneNumber: string, defaultCountry?: CountryCode): boolean {
    try {
      const parsed = parsePhoneNumber(phoneNumber, defaultCountry);
      return parsed ? parsed.isValid() : false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Gets country code from phone number
   * @param phoneNumber - Raw phone number string
   * @param defaultCountry - Default country code if not specified in number
   * @returns Country code (e.g., 'US', 'RU', 'GB')
   */
  static getCountry(
    phoneNumber: string,
    defaultCountry?: CountryCode,
  ): CountryCode | undefined {
    try {
      const parsed = parsePhoneNumber(phoneNumber, defaultCountry);
      return parsed?.country;
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Normalizes phone number for storage (removes all formatting, keeps only digits with +)
   * This is useful for consistent storage and comparison
   * @param phoneNumber - Raw phone number string
   * @param defaultCountry - Default country code if not specified in number (defaults to 'RU')
   * @returns Normalized phone number in E.164 format
   */
  static normalize(phoneNumber: string, defaultCountry?: CountryCode): string {
    if (phoneNumber.startsWith('8')) {
      phoneNumber = phoneNumber.replace(/^8/, '7');
    }

    if (!phoneNumber.startsWith('+')) {
      phoneNumber = '+' + phoneNumber;
    }
    return this.formatToE164(phoneNumber, defaultCountry);
  }

  /**
   * Parses phone number and returns detailed information
   * @param phoneNumber - Raw phone number string
   * @param defaultCountry - Default country code if not specified in number
   * @returns PhoneNumber object with detailed information or null if invalid
   */
  static parse(
    phoneNumber: string,
    defaultCountry?: CountryCode,
  ): PhoneNumber | null {
    try {
      const parsed = parsePhoneNumber(phoneNumber, defaultCountry);
      return parsed && parsed.isValid() ? parsed : null;
    } catch (error) {
      return null;
    }
  }
}
