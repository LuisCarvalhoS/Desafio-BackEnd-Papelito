import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { PrismaService } from './../src/modules/database/prisma.service';

// E2E tests connect to localhost instead of Docker's 'db' hostname
process.env.DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5432/papelito?schema=public';

describe('Orders E2E', () => {
  let app: INestApplication<App>;
  let accessToken: string;
  let createdOrderId: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    // Clean database before running tests
    const prisma = app.get(PrismaService);
    await prisma.orderItem.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.order.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/login', () => {
    it('should return a JWT token with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'admin', password: 'admin' })
        .expect(201);

      expect(response.body.access_token).toBeDefined();
      expect(typeof response.body.access_token).toBe('string');

      accessToken = response.body.access_token;
    });

    it('should return 401 with invalid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'admin', password: 'wrong' })
        .expect(401);

      expect(response.body.statusCode).toBe(401);
    });
  });

  describe('POST /v1/orders', () => {
    it('should return 401 without JWT', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/orders')
        .send({ external_id: 'PED-E2E-001' })
        .expect(401);

      expect(response.body.statusCode).toBe(401);
    });

    it('should return 400 with invalid payload', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ external_id: 'PED-E2E-002' })
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toBeInstanceOf(Array);
    });

    it('should create an order with PENDING status', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          external_id: 'PED-E2E-100',
          customer: {
            name: 'E2E User',
            email: 'e2e@test.com',
            document: '000.000.000-00',
          },
          items: [{ sku: 'E2E-SKU', quantity: 1, price: 25.5 }],
          total: 25.5,
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.external_id).toBe('PED-E2E-100');
      expect(response.body.total).toBe(25.5);
      expect(response.body.salesforce_status).toBe('PENDING');
      expect(response.body.salesforce_id).toBeNull();
      expect(response.body.customer.name).toBe('E2E User');
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].sku).toBe('E2E-SKU');

      createdOrderId = response.body.id;
    });

    it('should sync with Salesforce in the background', async () => {
      // Wait for the background sync to complete
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const response = await request(app.getHttpServer())
        .get(`/v1/orders/${createdOrderId}`)
        .expect(200);

      expect(response.body.salesforce_status).toBe('SYNCED');
      expect(response.body.salesforce_id).toMatch(/^SF-/);
    });

    it('should return 409 for duplicate external_id', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          external_id: 'PED-E2E-100',
          customer: {
            name: 'Duplicate',
            email: 'dup@test.com',
            document: '111',
          },
          items: [{ sku: 'DUP', quantity: 1, price: 10 }],
          total: 10,
        })
        .expect(409);

      expect(response.body.statusCode).toBe(409);
      expect(response.body.message).toContain('already exists');
    });
  });

  describe('GET /v1/orders/:id', () => {
    it('should return the created order', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/orders/${createdOrderId}`)
        .expect(200);

      expect(response.body.id).toBe(createdOrderId);
      expect(response.body.customer).toBeDefined();
      expect(response.body.items).toBeInstanceOf(Array);
      expect(response.body.salesforce_status).toBeDefined();
    });

    it('should return 404 for non-existent order', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/orders/99999')
        .expect(404);

      expect(response.body.statusCode).toBe(404);
      expect(response.body.message).toContain('not found');
    });
  });
});
