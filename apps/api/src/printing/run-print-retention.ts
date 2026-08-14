import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { PrintRetentionService } from './print-retention.service.js';

const valueAfter = (args: readonly string[], flag: string): string | null => {
  const index = args.indexOf(flag);
  return index === -1 ? null : (args[index + 1] ?? null);
};

export const parsePrintRetentionArguments = (
  args: readonly string[],
): Readonly<{ cutoff: Date; batchSize: number }> => {
  const cutoffText = valueAfter(args, '--cutoff');
  const batchSizeText = valueAfter(args, '--batch-size');
  const cutoff = new Date(cutoffText ?? '');
  const batchSize = Number(batchSizeText);
  if (
    cutoffText === null ||
    batchSizeText === null ||
    !Number.isFinite(cutoff.getTime()) ||
    !Number.isSafeInteger(batchSize)
  ) {
    throw new Error(
      'Usage: printing:retention -- --cutoff <UTC_ISO> --batch-size <integer>',
    );
  }
  return { cutoff, batchSize };
};

async function main(): Promise<void> {
  const application = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const input = parsePrintRetentionArguments(process.argv.slice(2));
    const result = await application
      .get(PrintRetentionService)
      .redactExpiredPayloads(input.cutoff, input.batchSize);
    console.log(JSON.stringify(result));
  } finally {
    await application.close();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error('Print retention failed.', error);
    process.exitCode = 1;
  });
}
