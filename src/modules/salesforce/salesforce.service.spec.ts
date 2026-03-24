import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SalesforceService, SalesforceException } from './salesforce.service';

describe('SalesforceService', () => {
  let service: SalesforceService;
  let configService: ConfigService;

  const mockOrder = {
    id: 1,
    external_id: 'PED-001',
    total: '100.00',
    customer: { name: 'John', email: 'john@test.com', document: '123' },
    items: [{ sku: 'SKU-1', quantity: 2, price: '50.00' }],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesforceService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('false') },
        },
      ],
    }).compile();

    service = module.get<SalesforceService>(SalesforceService);
    configService = module.get<ConfigService>(ConfigService);

    // Mock sleep to avoid real delays in tests
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
  });

  describe('syncOrder — success', () => {
    it('should return a salesforce_id matching SF-xxxxxxxx format', async () => {
      const result = await service.syncOrder(mockOrder);

      expect(result).toBeDefined();
      expect(result.salesforce_id).toMatch(/^SF-[a-f0-9]{8}$/);
    });

    it('should resolve on first attempt when SALESFORCE_FAIL is false', async () => {
      const spy = jest.spyOn(service as any, 'simulateApiCall');

      await service.syncOrder(mockOrder);

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('syncOrder — failure (SALESFORCE_FAIL=true)', () => {
    beforeEach(() => {
      jest.spyOn(configService, 'get').mockReturnValue('true');
    });

    it('should throw SalesforceException after all retries', async () => {
      await expect(service.syncOrder(mockOrder)).rejects.toThrow(
        SalesforceException,
      );
    });

    it('should throw with status 502 (BAD_GATEWAY)', async () => {
      try {
        await service.syncOrder(mockOrder);
        fail('Expected SalesforceException');
      } catch (error) {
        expect(error).toBeInstanceOf(SalesforceException);
        expect((error as SalesforceException).getStatus()).toBe(502);
      }
    });

    it('should include "failed after 3 attempts" in error message', async () => {
      await expect(service.syncOrder(mockOrder)).rejects.toThrow(
        /failed after 3 attempts/,
      );
    });

    it('should attempt exactly 3 times before failing', async () => {
      const spy = jest.spyOn(service as any, 'simulateApiCall');

      await expect(service.syncOrder(mockOrder)).rejects.toThrow();

      expect(spy).toHaveBeenCalledTimes(3);
    });
  });

  describe('syncOrder — retry then succeed', () => {
    it('should succeed after one failed attempt', async () => {
      const spy = jest.spyOn(service as any, 'simulateApiCall');
      spy
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({ salesforce_id: 'SF-abc12345' });

      const result = await service.syncOrder(mockOrder);

      expect(result.salesforce_id).toBe('SF-abc12345');
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe('exponential backoff', () => {
    it('should apply increasing delays between retries', async () => {
      jest.spyOn(configService, 'get').mockReturnValue('true');
      const sleepSpy = jest
        .spyOn(service as any, 'sleep')
        .mockResolvedValue(undefined);

      await expect(service.syncOrder(mockOrder)).rejects.toThrow();

      // Filter out the simulated API latency calls (200-600ms)
      // and keep only the retry delay calls (>= 1000ms)
      const delayCalls = sleepSpy.mock.calls
        .map((call) => call[0] as number)
        .filter((ms) => ms >= 1000);

      expect(delayCalls).toHaveLength(2);
      expect(delayCalls[0]).toBeGreaterThanOrEqual(1000);
      expect(delayCalls[0]).toBeLessThanOrEqual(1500);
      expect(delayCalls[1]).toBeGreaterThanOrEqual(2000);
      expect(delayCalls[1]).toBeLessThanOrEqual(2500);
    });
  });
});
