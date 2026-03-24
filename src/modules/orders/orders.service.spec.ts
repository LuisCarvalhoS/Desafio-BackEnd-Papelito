import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrdersService } from './orders.service';
import { PrismaService } from '../database/prisma.service';
import {
  SalesforceException,
  SalesforceService,
} from '../salesforce/salesforce.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: PrismaService;
  let salesforceService: SalesforceService;

  const mockCreatedOrder = {
    id: 1,
    external_id: 'PED-001',
    total: new Prisma.Decimal('100.00'),
    salesforce_status: 'PENDING' as const,
    salesforce_id: null,
    error_message: null,
    created_at: new Date('2026-01-01'),
    customer: {
      id: 1,
      name: 'John',
      email: 'john@test.com',
      document: '123',
      order_id: 1,
    },
    items: [
      {
        id: 1,
        sku: 'SKU-1',
        quantity: 2,
        price: new Prisma.Decimal('50.00'),
        order_id: 1,
      },
    ],
  };

  const mockDto = {
    external_id: 'PED-001',
    total: 100.0,
    customer: { name: 'John', email: 'john@test.com', document: '123' },
    items: [{ sku: 'SKU-1', quantity: 2, price: 50.0 }],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: PrismaService,
          useValue: {
            order: {
              create: jest.fn().mockResolvedValue(mockCreatedOrder),
              update: jest.fn(),
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: SalesforceService,
          useValue: {
            syncOrder: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    prisma = module.get<PrismaService>(PrismaService);
    salesforceService = module.get<SalesforceService>(SalesforceService);
  });

  describe('createOrder — returns PENDING immediately', () => {
    it('should return order with PENDING status', async () => {
      jest
        .spyOn(salesforceService, 'syncOrder')
        .mockResolvedValue({ salesforce_id: 'SF-abc12345' });
      jest.spyOn(prisma.order, 'update').mockResolvedValue({} as any);

      const result = await service.createOrder(mockDto);

      expect(result.salesforce_status).toBe('PENDING');
      expect(result.salesforce_id).toBeNull();
      expect(result.error_message).toBeNull();
      expect(prisma.order.create).toHaveBeenCalledTimes(1);
    });

    it('should return correct response DTO shape', async () => {
      jest
        .spyOn(salesforceService, 'syncOrder')
        .mockResolvedValue({ salesforce_id: 'SF-abc12345' });
      jest.spyOn(prisma.order, 'update').mockResolvedValue({} as any);

      const result = await service.createOrder(mockDto);

      expect(result).toEqual({
        id: 1,
        external_id: 'PED-001',
        total: 100,
        salesforce_status: 'PENDING',
        salesforce_id: null,
        error_message: null,
        created_at: expect.any(Date),
        customer: {
          id: 1,
          name: 'John',
          email: 'john@test.com',
          document: '123',
        },
        items: [{ id: 1, sku: 'SKU-1', quantity: 2, price: 50 }],
      });
    });

    it('should trigger Salesforce sync in the background', async () => {
      const syncSpy = jest
        .spyOn(salesforceService, 'syncOrder')
        .mockResolvedValue({ salesforce_id: 'SF-abc12345' });
      jest.spyOn(prisma.order, 'update').mockResolvedValue({} as any);

      await service.createOrder(mockDto);

      // Wait for the background promise to settle
      await new Promise((resolve) => setImmediate(resolve));

      expect(syncSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('background sync — SYNCED flow', () => {
    it('should update order to SYNCED after successful sync', async () => {
      jest
        .spyOn(salesforceService, 'syncOrder')
        .mockResolvedValue({ salesforce_id: 'SF-abc12345' });
      const updateSpy = jest
        .spyOn(prisma.order, 'update')
        .mockResolvedValue({} as any);

      await service.createOrder(mockDto);
      await new Promise((resolve) => setImmediate(resolve));

      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            salesforce_status: 'SYNCED',
            salesforce_id: 'SF-abc12345',
          }),
        }),
      );
    });
  });

  describe('background sync — FAILED flow', () => {
    it('should update order to FAILED when Salesforce sync fails', async () => {
      jest
        .spyOn(salesforceService, 'syncOrder')
        .mockRejectedValue(
          new SalesforceException('Salesforce sync failed after 3 attempts'),
        );
      const updateSpy = jest
        .spyOn(prisma.order, 'update')
        .mockResolvedValue({} as any);

      await service.createOrder(mockDto);
      await new Promise((resolve) => setImmediate(resolve));

      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            salesforce_status: 'FAILED',
            error_message: 'Salesforce sync failed after 3 attempts',
          }),
        }),
      );
    });

    it('should use "Unknown Salesforce error" for non-SalesforceException errors', async () => {
      jest
        .spyOn(salesforceService, 'syncOrder')
        .mockRejectedValue(new Error('random error'));
      const updateSpy = jest
        .spyOn(prisma.order, 'update')
        .mockResolvedValue({} as any);

      await service.createOrder(mockDto);
      await new Promise((resolve) => setImmediate(resolve));

      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            error_message: 'Unknown Salesforce error',
          }),
        }),
      );
    });
  });

  describe('createOrder — duplicate external_id', () => {
    it('should throw ConflictException on unique constraint violation', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '6.0.0',
          meta: { target: ['external_id'] },
        },
      );
      jest.spyOn(prisma.order, 'create').mockRejectedValue(prismaError);

      await expect(service.createOrder(mockDto)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.createOrder(mockDto)).rejects.toThrow(
        /already exists/,
      );
    });
  });

  describe('getOrderById', () => {
    it('should return order when found', async () => {
      const syncedOrder = {
        ...mockCreatedOrder,
        salesforce_status: 'SYNCED' as const,
        salesforce_id: 'SF-abc12345',
      };
      jest
        .spyOn(prisma.order, 'findUnique')
        .mockResolvedValue(syncedOrder as any);

      const result = await service.getOrderById(1);

      expect(result.id).toBe(1);
      expect(result.external_id).toBe('PED-001');
      expect(prisma.order.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: { customer: true, items: true },
      });
    });

    it('should throw NotFoundException when order does not exist', async () => {
      jest.spyOn(prisma.order, 'findUnique').mockResolvedValue(null);

      await expect(service.getOrderById(999)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getOrderById(999)).rejects.toThrow(/999 not found/);
    });
  });
});
