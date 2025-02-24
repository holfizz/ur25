import { Module } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { TelegramClient } from '../telegram/telegram.client'
import { OfferService } from './offer.service'

@Module({
	providers: [OfferService, PrismaService, TelegramClient],
	exports: [OfferService],
})
export class OfferModule {}
