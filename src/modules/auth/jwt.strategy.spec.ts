import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('test-secret'),
          },
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  describe('validate', () => {
    it('should return userId and username from JWT payload', () => {
      const payload = { sub: '1', username: 'admin' };

      const result = strategy.validate(payload);

      expect(result).toEqual({ userId: '1', username: 'admin' });
    });

    it('should map sub field to userId', () => {
      const payload = { sub: '42', username: 'testuser' };

      const result = strategy.validate(payload);

      expect(result.userId).toBe('42');
      expect(result.username).toBe('testuser');
    });
  });
});
