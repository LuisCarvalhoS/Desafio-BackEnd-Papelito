import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export interface SyncOrderData {
  id: number;
  external_id: string;
  total: number | string;
  customer?: {
    name: string;
    email: string;
    document: string;
  } | null;
  items: Array<{
    sku: string;
    quantity: number;
    price: number | string;
  }>;
}

export interface SyncOrderResult {
  salesforce_id: string;
}

export class SalesforceException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.BAD_GATEWAY);
  }
}

@Injectable()
export class SalesforceService {
  private readonly logger = new Logger(SalesforceService.name);
  private readonly MAX_ATTEMPTS = 3;
  private readonly BASE_DELAY_MS = 1000;
  private readonly MAX_JITTER_MS = 500;

  constructor(private readonly config: ConfigService) {}

  async syncOrder(order: SyncOrderData): Promise<SyncOrderResult> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.MAX_ATTEMPTS; attempt++) {
      try {
        this.logger.log(
          `Attempt ${attempt}/${this.MAX_ATTEMPTS} — syncing order #${order.external_id}`,
        );
        const result = await this.simulateApiCall(order);
        this.logger.log(
          `Order #${order.external_id} synced — salesforce_id: ${result.salesforce_id}`,
        );
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `Attempt ${attempt}/${this.MAX_ATTEMPTS} failed for order #${order.external_id}: ${lastError.message}`,
        );

        if (attempt < this.MAX_ATTEMPTS) {
          const delay = this.calculateDelay(attempt);
          this.logger.log(`Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    const finalMessage = `Salesforce sync failed after ${this.MAX_ATTEMPTS} attempts: ${lastError!.message}`;
    this.logger.error(finalMessage);
    throw new SalesforceException(finalMessage);
  }

  private async simulateApiCall(
    _order: SyncOrderData,
  ): Promise<SyncOrderResult> {
    await this.sleep(this.randomBetween(200, 600));

    const shouldFail = this.config.get<string>('SALESFORCE_FAIL') === 'true';

    if (shouldFail) {
      if (Math.random() < 0.5) {
        throw new Error('Salesforce API timeout: request exceeded 30000ms');
      } else {
        throw new Error('Salesforce API error: 500 Internal Server Error');
      }
    }

    return {
      salesforce_id: `SF-${randomUUID().substring(0, 8)}`,
    };
  }

  private calculateDelay(attempt: number): number {
    const exponential = this.BASE_DELAY_MS * Math.pow(2, attempt - 1);
    const jitter = Math.floor(Math.random() * this.MAX_JITTER_MS);
    return exponential + jitter;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
