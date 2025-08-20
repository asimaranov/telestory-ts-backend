import { PhoneUtils } from './phone.utils';

describe('PhoneUtils', () => {
  describe('normalize', () => {
    it('Should normalize 31687291674', () => {
      const result = PhoneUtils.normalize('+31687291674');
      expect(result).toBe('+31687291674');
    });

    it('should normalize Russian phone number with country code', () => {
      const result = PhoneUtils.normalize('+7 912 345 67 89');
      expect(result).toBe('+79123456789');
    });

    it('should normalize Russian phone number without country code using default RU', () => {
      const result = PhoneUtils.normalize('9123456789');
      expect(result).toBe('+79123456789');
    });

    it('should normalize Russian phone number starting with 8', () => {
      const result = PhoneUtils.normalize('89123456789');
      expect(result).toBe('+79123456789');
    });

    it('should handle phone numbers with spaces and special characters', () => {
      const result = PhoneUtils.normalize('+7 (912) 345-67-89');
      expect(result).toBe('+79123456789');
    });

    it('should throw error for invalid phone number', () => {
      expect(() => PhoneUtils.normalize('123')).toThrow(
        'Phone number formatting failed',
      );
    });

    it('should work with explicit country code parameter', () => {
      const result = PhoneUtils.normalize('2125551234', 'US');
      expect(result).toBe('+12125551234');
    });
  });

  describe('isValid', () => {
    it('should validate correct Russian phone number', () => {
      expect(PhoneUtils.isValid('+79123456789')).toBe(true);
    });

    it('should validate Russian phone number with default country', () => {
      expect(PhoneUtils.isValid('9123456789', 'RU')).toBe(true);
    });

    it('should reject invalid phone number', () => {
      expect(PhoneUtils.isValid('123')).toBe(false);
    });
  });
});
